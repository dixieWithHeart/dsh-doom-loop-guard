// 特征分布：以 loop-rescue 检测器为弱标注，统计各特征在「它判循环」与「它判正常」两组的分位数
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { measure, stripCode } from '../src/detect.js'

const file = process.argv[2]
const detectorPath = process.argv[3]
const out = process.argv[4] || 'feature-stats.txt'

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
  const item = {
    worst: m.worstCount,
    gap: m.minRepeatGap,
    ratio: m.shortRepeatRatio,
    dash: m.maxDashRun,
    paren: m.maxParenRun,
    len: text.length
  }
  if (detectInText('reasoning', text)) pos.push(item)
  else neg.push(item)
}

const q = (arr, p) => {
  if (!arr.length) return 0
  const vals = arr.map((x) => x).sort((a, b) => a - b)
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))]
}

const linesOut = [`阳性=${pos.length} 阴性=${neg.length}`, '']
for (const key of ['worst', 'gap', 'ratio', 'dash', 'paren', 'len']) {
  const a = pos.map((x) => x[key])
  const b = neg.map((x) => x[key])
  linesOut.push(
    `${key.padEnd(6)} 阳: p10=${q(a, 0.1)} p50=${q(a, 0.5)} p90=${q(a, 0.9)} | 阴: p50=${q(b, 0.5)} p90=${q(b, 0.9)} p99=${q(b, 0.99)} p999=${q(b, 0.999)} max=${q(b, 1)}`
  )
}

// 阴性里 worst/gap 组合的分布：看看「worst>=15 且 gap<=15」会误伤多少
for (const [w, g] of [[15, 15], [15, 8], [18, 8], [20, 8], [20, 5], [25, 5]]) {
  const hitPos = pos.filter((x) => x.worst >= w && x.gap > 0 && x.gap <= g).length
  const hitNeg = neg.filter((x) => x.worst >= w && x.gap > 0 && x.gap <= g).length
  linesOut.push(`规则 worst>=${w} && gap<=${g}: 阳性命中 ${hitPos}/${pos.length}  阴性命中 ${hitNeg}/${neg.length}`)
}

writeFileSync(out, linesOut.join('\n'), 'utf8')
console.log(linesOut.join('\n'))
