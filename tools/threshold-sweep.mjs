// 阈值组合搜索：以 loop-rescue 为弱标注，找召回与误报的平衡点
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { measure, stripCode } from '../src/detect.js'

const file = process.argv[2]
const detectorPath = process.argv[3]
const { detectInText } = await import(pathToFileURL(detectorPath).href)
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())

const pos = []
const neg = []
for (const line of lines) {
  let row
  try { row = JSON.parse(line) } catch { continue }
  const text = row.text
  if (typeof text !== 'string' || text.length < 200) continue
  const m = measure(stripCode(text)).stats
  const item = { worst: m.worstCount, gap: m.minRepeatGap, ratio: m.shortRepeatRatio, dash: m.maxDashRun, paren: m.maxParenRun }
  if (detectInText('reasoning', text)) pos.push(item)
  else neg.push(item)
}

const isSym = (x) => x.dash >= 300 || x.paren >= 60
const combos = [
  { w: 12, g: 8, r: 0.08 },
  { w: 12, g: 10, r: 0.08 },
  { w: 15, g: 8, r: 0.08 },
  { w: 15, g: 10, r: 0.08 },
  { w: 15, g: 12, r: 0.08 },
  { w: 15, g: 15, r: 0.08 },
  { w: 15, g: 8, r: 0.05 },
  { w: 12, g: 8, r: 0.05 },
  { w: 10, g: 8, r: 0.08 },
  { w: 15, g: 8, r: 0 }
]

console.log('组合\t阳性召回\t阴性误报(纯loop规则)')
for (const c of combos) {
  const hit = (x) => x.worst >= c.w && x.gap > 0 && x.gap <= c.g && x.ratio >= c.r
  const p = pos.filter(hit).length
  const n = neg.filter(hit).length
  console.log(`worst>=${c.w} gap<=${c.g} ratio>=${c.r}\t${p}/${pos.length}\t${n}/${neg.length}`)
}

// 符号规则 + 新 loop 规则的整体覆盖
const best = { w: 15, g: 8, r: 0.08 }
const full = (x) => isSym(x) || (x.worst >= best.w && x.gap > 0 && x.gap <= best.g && x.ratio >= best.r)
console.log(`\n整体（符号+循环）positive=${pos.filter(full).length}/${pos.length} negative=${neg.filter(full).length}/${neg.length}`)
