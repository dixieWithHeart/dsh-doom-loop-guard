// 生成「推理循环摘录」markdown：只保留循环前的临界内容与循环开始后的原始片段。
//
// 用法：node tools\export-loop-post.mjs <zcode_all.jsonl> <sessions.json> <out.md> [每会话条数(0=全部)]
import { readFileSync, writeFileSync } from 'node:fs'

import { DEFAULTS } from '../src/constants.js'
import { detect, stripCode } from '../src/detect.js'

const [jsonlPath, sessionsPath, outPath, perSessionArg] = process.argv.slice(2)
const perSession = Number(perSessionArg || 0)
const sessions = JSON.parse(readFileSync(sessionsPath, 'utf8'))
const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim())

const DASH_RUN = /(?:——\*{0,2}\s*){3,}/g
const PAREN_RUN = /（{4,}/g

function symbolCut (text) {
  let best = { len: 0, index: 0, type: '' }
  for (const m of text.matchAll(DASH_RUN)) {
    if (m[0].length > best.len) best = { len: m[0].length, index: m.index, type: '破折号' }
  }
  for (const m of text.matchAll(PAREN_RUN)) {
    if (m[0].length > best.len) best = { len: m[0].length, index: m.index, type: '括号' }
  }
  return best.len > 0 ? best : null
}

/** 找循环真正开始的位置：同一句连续三次密集出现（间隔 ≤30 字符）的起点。 */
function loopCut (text, sentence) {
  if (!sentence) return 0
  let pos = text.indexOf(sentence)
  if (pos < 0) return 0
  let runStart = pos
  let prev = pos
  let run = 1
  for (;;) {
    const next = text.indexOf(sentence, prev + sentence.length)
    if (next < 0) break
    if (next - prev <= 30) {
      run++
      if (run >= 3) return runStart
    } else {
      run = 1
      runStart = next
    }
    prev = next
  }
  return runStart
}

function clip (text, from, to) {
  return text.slice(Math.max(0, from), Math.max(0, to)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** 从 cut 往前取一段，尽量从行首开始，避免半句起头。 */
function headBefore (text, cut, minChars) {
  let start = Math.max(0, cut - minChars)
  if (start > 0) {
    const nl = text.indexOf('\n', start)
    if (nl !== -1 && nl < cut) start = nl + 1
  }
  return clip(text, start, cut)
}

/** 把连续重复的短片段折叠成「×N」，保留循环形态但不刷屏。 */
function foldRepeat (segment) {
  const parts = segment.split(/(?<=[。！？\n])/)
  const out = []
  let i = 0
  while (i < parts.length) {
    const unit = parts[i]
    let n = 1
    while (i + n < parts.length && parts[i + n] === unit) n++
    if (n >= 3 && unit.trim().length > 0) {
      out.push(unit.repeat(Math.min(n, 3)).trimEnd() + `\n  〔同一句原样重复 ${n} 次〕`)
      i += n
    } else {
      out.push(unit)
      i++
    }
  }
  return out.join('')
}

function ts (ms) {
  try {
    const d = new Date(Number(ms))
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch {
    return '?'
  }
}

const bySession = new Map()
let total = 0
const kindCount = { 短句: 0, 破折号: 0, 括号: 0 }
let maxDash = 0
let maxRepeat = 0

for (const line of lines) {
  let row
  try { row = JSON.parse(line) } catch { continue }
  const text = row.text
  if (typeof text !== 'string' || text.length < 200) continue
  const plain = stripCode(text)
  const finding = detect(plain, DEFAULTS)
  if (!finding.collapsed) continue
  total++

  const sym = symbolCut(plain)
  const kind = finding.kind === 'symbol' ? (sym ? sym.type : '破折号') : '短句'
  kindCount[kind] = (kindCount[kind] || 0) + 1
  if (kind === '破折号' && sym) maxDash = Math.max(maxDash, sym.len)
  if (kind === '短句') maxRepeat = Math.max(maxRepeat, finding.stats.worstCount)

  const cut = sym ? sym.index : loopCut(plain, finding.stats.worstSentence)
  const head = headBefore(plain, cut, 280)
  const body = foldRepeat(clip(plain, cut, cut + 1400))

  const list = bySession.get(row.session) || []
  list.push({
    chars: text.length,
    kind,
    len: sym ? sym.len : 0,
    worst: finding.stats.worstCount,
    gap: finding.stats.minRepeatGap,
    ratio: finding.stats.shortRepeatRatio,
    head,
    body
  })
  bySession.set(row.session, list)
}

const md = []
md.push('# zcode 推理循环摘录')
md.push('')
md.push(`- 样本范围：zcode 本机 **14187** 条思维链（≥200 字符）`)
md.push(`- 命中 **${total}** 条，分属 **${bySession.size}** 个会话`)
md.push(`- 形态：短句循环 ${kindCount.短句} 条、破折号填充 ${kindCount.破折号} 条、括号嵌套 ${kindCount.括号} 条`)
md.push(`- 极端值：最长连续破折号填充 ${maxDash} 字符、同一短句最高重复 ${maxRepeat} 次`)
md.push('')
md.push('每条只保留两段：循环开始前的最后一段内容（临界点）、循环开始后的原始片段。连续重复已折叠并标注次数。')
md.push('')
md.push('> 判定阈值：破折号填充 ≥800 字符 / 括号嵌套 ≥200 字符 / 短句重复 ≥15 次且相邻间隔 ≤8 字符。检测器在 443 条标注样本上召回 100%、误报 0。')
md.push('')

let si = 0
for (const [sid, items] of [...bySession.entries()].sort((a, b) => b[1].length - a[1].length)) {
  si++
  const meta = sessions[sid] || {}
  items.sort((a, b) => b.len - a.len || b.worst - a.worst)
  const shown = perSession > 0 ? items.slice(0, perSession) : items
  md.push('---')
  md.push('')
  md.push(`## ${si}. ${meta.title || sid}`)
  md.push('')
  md.push(`- 目录：\`${meta.dir || '?'}\``)
  md.push(`- 会话时间：${ts(meta.created)} ~ ${ts(meta.updated)}`)
  md.push(`- 命中：${items.length} 条${perSession > 0 && items.length > shown.length ? `，下面展示最典型的 ${shown.length} 条` : ''}`)
  md.push('')
  shown.forEach((it, i) => {
    const stat = it.kind === '短句'
      ? `短句循环 · 同一句重复 ${it.worst} 次 · 间隔 ${it.gap} 字符 · 占窗口 ${(it.ratio * 100).toFixed(0)}%`
      : `${it.kind}填充 · 连续 ${it.len} 字符`
    md.push(`### ${si}.${i + 1} ${stat} · 全条 ${it.chars} 字`)
    md.push('')
    md.push('**临界点（循环开始前的最后一段）**')
    md.push('')
    md.push('```text')
    md.push(it.head)
    md.push('```')
    md.push('')
    md.push('**循环开始**')
    md.push('')
    md.push('```text')
    md.push(it.body)
    md.push('```')
    md.push('')
  })
}

writeFileSync(outPath, md.join('\n'), 'utf8')
console.log(`sessions=${bySession.size} samples=${total} shown=${[...bySession.values()].reduce((a, v) => a + (perSession > 0 ? Math.min(v.length, perSession) : v.length), 0)} -> ${outPath}`)
