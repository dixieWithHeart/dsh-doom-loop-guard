// 只输出「loop-rescue 命中、本插件未命中」的完整片段，用于人工判定是否真循环
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { DEFAULTS } from '../src/constants.js'
import { detect, stripCode } from '../src/detect.js'

const file = process.argv[2]
const detectorPath = process.argv[3]
const out = process.argv[4] || 'theirs-only.txt'

const { detectInText } = await import(pathToFileURL(detectorPath).href)
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())

const rows = []
for (const line of lines) {
  let row
  try { row = JSON.parse(line) } catch { continue }
  const text = row.text
  if (typeof text !== 'string' || text.length < 200) continue
  const ours = detect(stripCode(text), DEFAULTS)
  const theirs = detectInText('reasoning', text)
  if (theirs && !ours.collapsed) {
    rows.push({
      session: row.session,
      chars: text.length,
      oursStats: ours.stats,
      head: text.slice(0, 280).replace(/\s+/g, ' '),
      mid: text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + 220).replace(/\s+/g, ' '),
      tail: text.slice(-220).replace(/\s+/g, ' ')
    })
  }
}

const output = rows.map((r, i) =>
  `### ${i + 1}. ${r.session}  ${r.chars}字  我们: dash=${r.oursStats.maxDashRun} worst=${r.oursStats.worstCount} gap=${r.oursStats.minRepeatGap} ratio=${r.oursStats.shortRepeatRatio.toFixed(2)}\n` +
  `HEAD: ${r.head}\nMID:  ${r.mid}\nTAIL: ${r.tail}\n`
).join('\n')

writeFileSync(out, output, 'utf8')
console.log(`theirs-only=${rows.length} -> ${out}`)
