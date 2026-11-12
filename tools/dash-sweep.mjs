// 在 443 条标注样本上扫 dash 阈值，同时保持 loop 规则不变
import { readFileSync } from 'node:fs'

import { measure, stripCode } from '../src/detect.js'

const samples = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const loopRule = { worst: 15, gap: 8, ratio: 0.05 }

const rows = samples.map((s) => {
  const m = measure(stripCode(s.text)).stats
  return { label: s.label, m }
})

const hitLoop = (m) => m.worstCount >= loopRule.worst && m.minRepeatGap > 0 && m.minRepeatGap <= loopRule.gap && m.shortRepeatRatio >= loopRule.ratio
const hitParen = (m) => m.maxParenRun >= 60

console.log('dash阈值\t阳性召回\t阴性误报')
for (const dash of [200, 300, 400, 500, 600, 700, 800, 1000]) {
  const hit = (m) => m.maxDashRun >= dash || hitParen(m) || hitLoop(m)
  const tp = rows.filter((r) => r.label === 1 && hit(r.m)).length
  const fp = rows.filter((r) => r.label === 0 && hit(r.m)).length
  const pos = rows.filter((r) => r.label === 1).length
  const neg = rows.filter((r) => r.label === 0).length
  console.log(`${dash}\t${tp}/${pos}\t${fp}/${neg}`)
}

// 只 loop 规则的覆盖（不含符号）
const tpLoop = rows.filter((r) => r.label === 1 && hitLoop(r.m)).length
const fpLoop = rows.filter((r) => r.label === 0 && hitLoop(r.m)).length
console.log(`\n仅 loop 规则: 阳性 ${tpLoop} 阴性 ${fpLoop}`)
const tpParen = rows.filter((r) => r.label === 1 && hitParen(r.m)).length
const fpParen = rows.filter((r) => r.label === 0 && hitParen(r.m)).length
console.log(`仅 paren 规则: 阳性 ${tpParen} 阴性 ${fpParen}`)
