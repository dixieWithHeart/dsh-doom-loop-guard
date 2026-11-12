// 交叉验证：用 zcode 全库文本，同时跑「本插件检测器」与「dsh-loop-rescue 检测器」，
// 重点找 loop-rescue 命中但我们没命中的样本（我们的盲区）。
//
// 用法：node tools\cross-check.mjs <jsonl> <loop-rescue detector.js 路径>
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { DEFAULTS } from '../src/constants.js'
import { detect, stripCode } from '../src/detect.js'

const file = process.argv[2]
const detectorPath = process.argv[3]

const { detectInText } = await import(pathToFileURL(detectorPath).href)

const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
const stats = { total: 0, ours: 0, theirs: 0, both: 0, oursOnly: 0, theirsOnly: 0, neither: 0 }
const theirsOnlySamples = []
const oursOnlySamples = []

let high = 0
let low = 0
for (const line of lines) {
  let row
  try { row = JSON.parse(line) } catch { continue }
  const text = row.text
  if (typeof text !== 'string' || text.length < 200) continue
  stats.total++
  const f = detect(stripCode(text), DEFAULTS)
  const ours = f.collapsed
  const theirs = Boolean(detectInText('reasoning', text))
  if (ours) {
    stats.ours++
    if (f.confidence === 'high') high++
    else low++
  }
  if (theirs) stats.theirs++
  if (ours && theirs) stats.both++
  else if (ours) {
    stats.oursOnly++
    if (oursOnlySamples.length < 8) oursOnlySamples.push(text.slice(0, 140).replace(/\s+/g, ' '))
  } else if (theirs) {
    stats.theirsOnly++
    if (theirsOnlySamples.length < 8) theirsOnlySamples.push(text.slice(0, 140).replace(/\s+/g, ' '))
  } else stats.neither++
}

console.log(JSON.stringify({ ...stats, high, low }, null, 2))
console.log('\n--- loop-rescue 命中、我们没命中（疑似盲区）---')
for (const s of theirsOnlySamples) console.log('  -', s)
console.log('\n--- 我们命中、loop-rescue 没命中（符号填充）---')
for (const s of oursOnlySamples) console.log('  -', s)
