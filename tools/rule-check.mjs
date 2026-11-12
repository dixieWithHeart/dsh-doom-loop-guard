// 验证分档规则：强符号 / 中符号+循环特征 / 纯循环
import { readFileSync } from 'node:fs'

import { measure, stripCode } from '../src/detect.js'

const samples = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const rows = samples.map((s) => ({ label: s.label, m: measure(stripCode(s.text)).stats }))

function classify (m, o) {
  const loopStrong = m.worstCount >= 15 && m.minRepeatGap > 0 && m.minRepeatGap <= 8 && m.shortRepeatRatio >= 0.05
  const symbolStrong = m.maxDashRun >= 800 || m.maxParenRun >= 200
  const symbolWeak = m.maxDashRun >= 300 || m.maxParenRun >= 60
  const loopish = m.worstCount >= 10 || m.shortRepeatRatio >= 0.1
  return symbolStrong || loopStrong || (symbolWeak && loopish)
}

const hit = (m) => classify(m)
const tp = rows.filter((r) => r.label === 1 && hit(r.m)).length
const fp = rows.filter((r) => r.label === 0 && hit(r.m)).length
const pos = rows.filter((r) => r.label === 1).length
const neg = rows.filter((r) => r.label === 0).length
console.log(`分档规则: 阳性 ${tp}/${pos}  阴性 ${fp}/${neg}`)

const miss = rows.filter((r) => r.label === 1 && !hit(r.m))
console.log(`漏报 ${miss.length} 条:`)
for (const r of miss.slice(0, 10)) {
  console.log(`  dash=${r.m.maxDashRun} paren=${r.m.maxParenRun} worst=${r.m.worstCount} gap=${r.m.minRepeatGap} ratio=${r.m.shortRepeatRatio.toFixed(2)}`)
}
