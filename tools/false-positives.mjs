// 提取指定规则在阴性中命中的样本，以及符号规则的边界样本，供人工判定
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { measure, stripCode } from '../src/detect.js'

const file = process.argv[2]
const detectorPath = process.argv[3]
const out = process.argv[4] || 'false-positives.txt'
const { detectInText } = await import(pathToFileURL(detectorPath).href)
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())

const neg = []
for (const line of lines) {
  let row
  try { row = JSON.parse(line) } catch { continue }
  const text = row.text
  if (typeof text !== 'string' || text.length < 200) continue
  if (detectInText('reasoning', text)) continue
  const m = measure(stripCode(text)).stats
  neg.push({ text, m })
}

const loopHits = neg.filter((x) => x.m.worstCount >= 15 && x.m.minRepeatGap > 0 && x.m.minRepeatGap <= 8 && x.m.shortRepeatRatio >= 0.05)
const dashMid = neg.filter((x) => x.m.maxDashRun >= 300 && x.m.maxDashRun < 800)
const dashHigh = neg.filter((x) => x.m.maxDashRun >= 800)

const fmt = (x, tag) =>
  `### ${tag} dash=${x.m.maxDashRun} paren=${x.m.maxParenRun} worst=${x.m.worstCount} gap=${x.m.minRepeatGap} ratio=${x.m.shortRepeatRatio.toFixed(2)} len=${x.text.length}\n` +
  `${x.text.slice(0, 220).replace(/\s+/g, ' ')}\n`

const parts = []
parts.push(`阴性总数=${neg.length}`)
parts.push(`\n== loop 规则命中（worst>=15 gap<=8 ratio>=0.05）: ${loopHits.length} 条 ==`)
for (const x of loopHits) parts.push(fmt(x, 'loop'))
parts.push(`\n== dash 300-800（边界区）: ${dashMid.length} 条 ==`)
for (const x of dashMid.slice(0, 10)) parts.push(fmt(x, 'dash-mid'))
parts.push(`\n== dash>=800: ${dashHigh.length} 条 ==`)
for (const x of dashHigh.slice(0, 10)) parts.push(fmt(x, 'dash-high'))

writeFileSync(out, parts.join('\n'), 'utf8')
console.log(parts.slice(0, 3).join('\n'))
console.log('written ' + out)
