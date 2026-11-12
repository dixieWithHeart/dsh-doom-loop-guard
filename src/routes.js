/**
 * HTTP 路由：报告与设置。
 *
 * 与 DSH 常见插件同款，无鉴权——Web 入口本身要 token，
 * 但自注册路由本机进程都能读，因此只暴露低敏感数据（会话标题、目录、计数）。
 */

import { MAX_BODY_BYTES, ROUTE_PREFIX, VERSION } from './constants.js'
import { buildReport, sessionsRoot } from './report.js'
import { sanitize } from './settings.js'

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

async function readBody (req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > MAX_BODY_BYTES) return null
  }
  return body
}

export function createRoutes ({ getOptions, setOptions, persist, playSound, getEvents, log }) {
  return [
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/sound`,
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        // 可选 body：{ soundset } —— 设置页试听指定音色，不传则用当前设置。
        let payload = null
        try {
          const raw = await readBody(req)
          payload = raw ? JSON.parse(raw) : null
        } catch { payload = null }
        const soundset = payload && typeof payload.soundset === 'string' ? payload.soundset : ''
        let played = false
        try {
          played = typeof playSound === 'function'
            ? Boolean(playSound(soundset ? { soundset } : undefined))
            : false
        } catch (error) {
          log.warn(`sound route failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, played }))
      }
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({
          version: VERSION,
          settings: getOptions(),
          lastEvent: typeof getEvents === 'function' ? (getEvents()[0] || null) : null,
          sessionsRoot: sessionsRoot()
        }))
      }
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/report`,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
        const url = new URL(req.url || '/', 'http://localhost')
        const options = { ...getOptions() }
        const days = Number(url.searchParams.get('days'))
        const limit = Number(url.searchParams.get('limit'))
        if (Number.isFinite(days) && days > 0) options.reportDays = Math.min(3650, days)
        if (Number.isFinite(limit) && limit > 0) options.reportLimit = Math.min(200, limit)
        const report = await buildReport(options, log)
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, ...report }))
      }
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/set`,
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const body = await readBody(req)
        if (body === null) { res.writeHead(413); res.end(); return }
        let patch
        try {
          patch = JSON.parse(body || '{}')
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: '请求体不是合法 JSON', settings: getOptions() }))
          return
        }
        const current = getOptions()
        const next = sanitize(patch, current)
        const changed = JSON.stringify(next) !== JSON.stringify(current)
        if (changed) {
          // 先落盘再改内存：写失败时内存保持旧值，避免「界面已变、重启后回退」
          if (!persist(next)) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: '设置写入失败，见 DSH 日志', settings: getOptions() }))
            return
          }
          setOptions(next)
        }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, changed, settings: getOptions() }))
      }
    }
  ]
}
