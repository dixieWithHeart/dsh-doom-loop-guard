/**
 * 事后分析：扫描 DSH 会话存档（zstd 压缩、多帧 JSONL），提取 reasoning 并打分。
 *
 * 存档格式实测：每个文件由若干 zstd 帧组成，每帧一行 JSON 事件；
 * assistant/message 的 data.message.content 里带 {type:'reasoning', text}。
 *
 * 除逐条命中外，给每个会话一个 doom 分（0-100）：
 *   rate    = 命中条数 / 推理条数
 *   severity= 最差一条相对阈值的倍数（1.0 表示刚好过线）
 *   doom    = min(100, rate*400 + min(1, max(0, severity-1))*20)
 * 无命中会话也是 0 分，参与趋势统计。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { detect, stripCode } from './detect.js'

/** 单文件读取上限，防止把异常大的存档拖进内存。 */
const MAX_FILE_BYTES = 32 * 1024 * 1024

/** 趋势统计的天数。 */
const TREND_DAYS = 14

/** 存档根目录：DSH_HOME 优先，退回 ~/.dsh。 */
export function sessionsRoot () {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/** 把多帧 zstd 解成事件数组；坏帧跳过，不阻断整份报告。 */
function readEvents (buffer) {
  const events = []
  for (let i = 0; i + 4 <= buffer.length; i++) {
    if (buffer[i] !== 0x28 || buffer[i + 1] !== 0xb5 || buffer[i + 2] !== 0x2f || buffer[i + 3] !== 0xfd) continue
    let text
    try {
      text = zstdDecompressSync(buffer.subarray(i)).toString('utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line))
      } catch { /* 单行损坏忽略 */ }
    }
  }
  return events
}

/** 从一份存档里抽 reasoning 条目与元数据。 */
function parseSession (events) {
  const meta = { ...(events.find((e) => e && e.type === 'session') || {}) }
  const titleEvent = events.find((e) => e && e.type === 'session/title')
  if (titleEvent && titleEvent.data) {
    const t = titleEvent.data.title || titleEvent.data.text || ''
    if (typeof t === 'string' && t.trim()) meta.title = t.trim()
  }
  const reasoning = []
  for (const event of events) {
    if (!event || event.type !== 'assistant/message') continue
    const content = event.data && event.data.message && event.data.message.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block && (block.type === 'reasoning' || block.type === 'text') && typeof block.text === 'string' && block.text.length > 0) {
        reasoning.push({ type: block.type, seq: event.seq, turn: event.data.turn, step: event.data.step, text: block.text })
      }
    }
  }
  return { meta, reasoning }
}

/** 最差一条相对阈值的倍数。 */
function severityOf (hits, options) {
  let max = 0
  for (const h of hits) {
    const s = h.stats || {}
    const v = Math.max(
      options.maxDashRun > 0 ? (s.maxDashRun || 0) / options.maxDashRun : 0,
      options.maxParenRun > 0 ? (s.maxParenRun || 0) / options.maxParenRun : 0,
      options.shortSentenceRepeat > 0 ? (s.worstCount || 0) / options.shortSentenceRepeat : 0
    )
    if (v > max) max = v
  }
  return max
}

/**
 * doom 分（0-100）。强信号按 1 计，中信号（格式碎片）按 0.4 计。
 * @param {Array} hits
 * @param {number} reasoningCount
 * @param {number} severity 最差条目相对阈值的倍数
 */
export function doomOf (hits, reasoningCount, severity) {
  if (!reasoningCount) return 0
  let weighted = 0
  for (const h of hits) weighted += h.confidence === 'high' ? 1 : 0.4
  const rate = weighted / reasoningCount
  const bonus = Math.min(1, Math.max(0, severity - 1)) * 20
  return Math.min(100, Math.round(rate * 400 + bonus))
}

/** 扫一个会话文件，返回评分与命中条目（无命中也返回，供趋势统计）。 */
async function scanFile (file, options) {
  const info = await stat(file)
  if (info.size > MAX_FILE_BYTES) return null
  const events = readEvents(await readFile(file))
  const { meta, reasoning } = parseSession(events)
  if (reasoning.length === 0) return null

  const hits = []
  for (const item of reasoning) {
    const finding = detect(stripCode(item.text), options)
    if (!finding.collapsed) continue
    hits.push({
      type: item.type,
      seq: item.seq,
      turn: item.turn,
      step: item.step,
      chars: item.text.length,
      kind: finding.kind,
      confidence: finding.confidence,
      detail: finding.detail,
      stats: finding.stats,
      head: item.text.slice(0, 160).replace(/\s+/g, ' ')
    })
  }

  const severity = severityOf(hits, options)
  return {
    id: meta.id || file,
    cwd: meta.cwd || '',
    createdAt: meta.createdAt || null,
    updatedAt: info.mtimeMs,
    reasoningCount: reasoning.length,
    collapsedCount: hits.length,
    doom: doomOf(hits, reasoning.length, severity),
    hits: hits.sort((a, b) => b.chars - a.chars)
  }
}

/** 按天聚合的会话健康趋势（最近 TREND_DAYS 天，含无命中会话）。 */
function buildTrend (sessions) {
  const now = new Date()
  const buckets = new Map()
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    buckets.set(key, { date: key, sessions: 0, collapsed: 0, doomSum: 0 })
  }
  for (const s of sessions) {
    const d = new Date(s.updatedAt)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    const b = buckets.get(key)
    if (!b) continue
    b.sessions++
    if (s.collapsedCount > 0) b.collapsed++
    b.doomSum += s.doom
  }
  return [...buckets.values()].map((b) => ({
    date: b.date,
    sessions: b.sessions,
    collapsed: b.collapsed,
    avgDoom: b.sessions ? Math.round(b.doomSum / b.sessions) : 0
  }))
}

/**
 * 生成报告。
 * @param {object} options 生效设置
 * @param {{info:Function,warn:Function}} log
 */
export async function buildReport (options, log) {
  const root = sessionsRoot()
  const since = Date.now() - Math.max(1, Number(options.reportDays) || 7) * 24 * 3600 * 1000
  const all = []
  let scanned = 0
  let failed = 0

  let workspaces = []
  try {
    workspaces = await readdir(root, { withFileTypes: true })
  } catch (error) {
    log.warn(`sessions root unreadable: ${error instanceof Error ? error.message : String(error)}`)
    return { root, scanned: 0, failed: 0, totalCollapsedSessions: 0, trend: [], sessions: [] }
  }

  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue
    let dirs = []
    try {
      dirs = await readdir(join(root, ws.name), { withFileTypes: true })
    } catch { continue }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      let files = []
      try {
        files = await readdir(join(root, ws.name, dir.name))
      } catch { continue }
      for (const name of files) {
        if (!/^session\.v\d+\.jsonl\.zstd$/.test(name)) continue
        const file = join(root, ws.name, dir.name, name)
        try {
          const info = await stat(file)
          if (info.mtimeMs < since) continue
          scanned++
          const result = await scanFile(file, options)
          if (result) all.push(result)
        } catch (error) {
          failed++
          log.warn(`scan failed: ${name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  const collapsed = all.filter((s) => s.collapsedCount > 0)
  collapsed.sort((a, b) => b.doom - a.doom || b.collapsedCount - a.collapsedCount || b.updatedAt - a.updatedAt)
  const limit = Math.max(1, Number(options.reportLimit) || 20)
  const totalHits = collapsed.reduce((sum, s) => sum + s.collapsedCount, 0)
  const maxDoom = collapsed.reduce((max, s) => Math.max(max, s.doom), 0)
  return {
    root,
    scanned,
    failed,
    totalCollapsedSessions: collapsed.length,
    totalHits,
    maxDoom,
    trend: buildTrend(all),
    sessions: collapsed.slice(0, limit)
  }
}
