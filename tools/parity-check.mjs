// 用 zcode 标注样本验证检测器：召回（阳性）与误报（阴性）
import { readFileSync } from 'node:fs'

import { DEFAULTS } from '../src/constants.js'
import { detect, stripCode } from '../src/detect.js'

const path = process.argv[2]
const samples = JSON.parse(readFileSync(path, 'utf8'))

let tp = 0
let fn = 0
let fp = 0
let tn = 0
const fnList = []
const fpList = []

for (const s of samples) {
  const f = detect(stripCode(s.text), DEFAULTS)
  if (s.label === 1) {
    if (f.collapsed) tp++
    else {
      fn++
      fnList.push({ session: s.session, chars: s.text.length, stats: f.stats, head: s.text.slice(0, 80).replace(/\s+/g, ' ') })
    }
  } else if (f.collapsed) {
    fp++
    fpList.push({ session: s.session, chars: s.text.length, detail: f.detail, head: s.text.slice(0, 80).replace(/\s+/g, ' ') })
  } else {
    tn++
  }
}

const pos = tp + fn
const neg = fp + tn
console.log(`阳性 ${pos}: 召回 ${pos ? (tp / pos * 100).toFixed(1) : 0}% (${tp}/${pos})`)
console.log(`阴性 ${neg}: 误报 ${neg ? (fp / neg * 100).toFixed(1) : 0}% (${fp}/${neg})`)

if (fnList.length) {
  console.log('\n漏报样本:')
  for (const x of fnList.slice(0, 10)) console.log(`  ${x.chars}字 dash=${x.stats.maxDashRun} paren=${x.stats.maxParenRun} ratio=${x.stats.shortRepeatRatio.toFixed(2)} :: ${x.head}`)
}
if (fpList.length) {
  console.log('\n误报样本:')
  for (const x of fpList.slice(0, 10)) console.log(`  ${x.chars}字 ${x.detail} :: ${x.head}`)
}
