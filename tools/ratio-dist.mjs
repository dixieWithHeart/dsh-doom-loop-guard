// 统计真实 DSH 会话里 reasoning 的塌陷指标分布，用于定阈值
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { measure, stripCode } from '../src/detect.js'
import { sessionsRoot } from '../src/report.js'

const root = sessionsRoot()
const rows = []

function readEvents (buffer) {
  const events = []
  for (let i = 0; i + 4 <= buffer.length; i++) {
    if (buffer[i] !== 0x28 || buffer[i + 1] !== 0xb5 || buffer[i + 2] !== 0x2f || buffer[i + 3] !== 0xfd) continue
    try {
      const text = zstdDecompressSync(buffer.subarray(i)).toString('utf8')
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try { events.push(JSON.parse(line)) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  return events
}

for (const ws of await readdir(root, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  for (const dir of await readdir(join(root, ws.name), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const name of await readdir(join(root, ws.name, dir.name))) {
      if (!/^session\.v\d+\.jsonl\.zstd$/.test(name)) continue
      const file = join(root, ws.name, dir.name, name)
      const info = await stat(file)
      if (info.size > 32 * 1024 * 1024) continue
      const events = readEvents(await readFile(file))
      for (const ev of events) {
        if (!ev || ev.type !== 'assistant/message') continue
        const content = ev.data?.message?.content
        if (!Array.isArray(content)) continue
        for (const b of content) {
          if (b?.type !== 'reasoning' || typeof b.text !== 'string') continue
          const m = measure(stripCode(b.text))
          rows.push({ file: dir.name, chars: b.text.length, ratio: m.stats.shortRepeatRatio, dash: m.stats.maxDashRun, paren: m.stats.maxParenRun, worst: m.stats.worstCount })
        }
      }
    }
  }
}

const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]
const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b)
const dashes = rows.map((r) => r.dash).sort((a, b) => a - b)
const parens = rows.map((r) => r.paren).sort((a, b) => a - b)
console.log(`reasoning=${rows.length}`)
console.log(`ratio p50=${q(ratios, 0.5).toFixed(3)} p90=${q(ratios, 0.9).toFixed(3)} p99=${q(ratios, 0.99).toFixed(3)} p999=${q(ratios, 0.999).toFixed(3)} max=${ratios[ratios.length - 1].toFixed(3)}`)
console.log(`dash  p50=${q(dashes, 0.5)} p90=${q(dashes, 0.9)} p99=${q(dashes, 0.99)} max=${dashes[dashes.length - 1]}`)
console.log(`paren p50=${q(parens, 0.5)} p90=${q(parens, 0.9)} p99=${q(parens, 0.99)} max=${parens[parens.length - 1]}`)
console.log('top ratio rows:')
for (const r of rows.sort((a, b) => b.ratio - a.ratio).slice(0, 8)) {
  console.log(`  ratio=${r.ratio.toFixed(3)} worst=${r.worst} chars=${r.chars} ${r.file}`)
}
