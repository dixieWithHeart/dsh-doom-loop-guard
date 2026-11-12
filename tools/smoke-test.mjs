// 契约冒烟：检测函数的阳性 / 阴性断言。
// 用 zcode 实测到的三类塌陷原文片段做阳性对照，用正常推理与代码块做阴性对照。
import assert from 'node:assert/strict'

import { DEFAULTS } from '../src/constants.js'
import { detect, measure, stripCode } from '../src/detect.js'

const limits = { ...DEFAULTS }

let passed = 0
function check (name, fn) {
  try {
    fn()
    passed++
    console.log(`ok  ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

// 阳性 1：破折号填充（case1 原文片段）
const dashSample = '**巨大突破**：`A929994E`（Bad cast node）——**目标类名**："HUD Main"！' + '——**——**——**'.repeat(250)
check('破折号填充被判为 symbol', () => {
  const f = detect(stripCode(dashSample), limits)
  assert.equal(f.collapsed, true)
  assert.equal(f.kind, 'symbol')
  assert.ok(f.stats.maxDashRun >= 300)
})

// 阳性 2：括号嵌套（case2 原文片段）
const parenSample = '新的错误清单（最新编译）：' + '（'.repeat(250) + '必须收敛'
check('括号嵌套被判为 symbol', () => {
  const f = detect(stripCode(parenSample), limits)
  assert.equal(f.collapsed, true)
  assert.equal(f.kind, 'symbol')
  assert.equal(f.confidence, 'high')
  assert.ok(f.stats.maxParenRun >= 200)
})

// 中信号：破折号碎片（300-800）只进报告，不触发实时提醒
const weakDash = '说明：' + '——**——**——**'.repeat(60)
check('破折号碎片判为 low 置信', () => {
  const f = detect(stripCode(weakDash), limits)
  assert.equal(f.collapsed, true)
  assert.equal(f.confidence, 'low')
})

// 阳性 3：短句循环（Pi agent 原文片段）
const loopSample = '好。执行。'.repeat(40) + '验证服务状态。'
check('短句空转被判为 loop', () => {
  const f = detect(stripCode(loopSample), limits)
  assert.equal(f.collapsed, true)
  assert.equal(f.kind, 'loop')
  assert.ok(f.stats.worstCount >= 8)
  assert.ok(f.stats.shortRepeatRatio >= 0.5)
})

// 阴性 1：正常长推理
const normal = '先确认目录结构，再读知识库规范。当前上下文没有给出工作目录，需要先跑一次 Get-Location。'
  + '如果确认在项目模式，就加载知识库操作规范；否则按单次任务处理。'.repeat(3)
check('正常推理不塌陷', () => {
  const f = detect(stripCode(normal), limits)
  assert.equal(f.collapsed, false)
})

// 阴性 2：代码块里的缩进与括号不参与判定
const codeHeavy = '下面是实现：\n```js\n' + '  {\n    a: 1,\n  }\n'.repeat(60) + '```\n现在编译验证。'
check('代码块被剥离后不塌陷', () => {
  const f = detect(stripCode(codeHeavy), limits)
  assert.equal(f.collapsed, false)
})

// 边界：未闭合围栏（流式中途 / 被截断）应连同其后内容一起剥离
const unclosed = '说明：\n```js\nconst a = 1\n' + '好。执行。'.repeat(20)
check('未闭合代码围栏被剥离', () => {
  const out = stripCode(unclosed)
  assert.ok(!out.includes('好。执行。'), '围栏后的内容应被剥离')
  assert.ok(out.includes('说明'), '围栏前的内容应保留')
})

// 阴性 3：少量重复的真实场景（低于阈值）
const fewRepeat = '好。执行。好。执行。好。执行。然后读文件。'
check('少量重复不误报', () => {
  const f = detect(stripCode(fewRepeat), limits)
  assert.equal(f.collapsed, false)
})

// 阴性 4：长推理里列表编号与短语高频出现，但占比很低（真实误报场景回归）
const listy = Array.from({ length: 8 }, (_, i) =>
  `现在处理第 ${i + 1} 项。已完成。下一步。读文件，检查调用点，确认契约。写入修改，编译验证，记录结果。`
).join('')
check('列表型长推理不误报', () => {
  const f = detect(stripCode(listy), limits)
  assert.equal(f.collapsed, false)
})

// 弱信号：标点刷屏（连续感叹号 / 问号），只有长度没有语义，只进报告
check('连续感叹号判为 punct 弱信号', () => {
  const f = detect(stripCode('!'.repeat(30)), limits)
  assert.equal(f.collapsed, true)
  assert.equal(f.confidence, 'low')
  assert.equal(f.kind, 'punct')
  assert.equal(f.stats.maxPunctRun, 30)
})

check('标点不足阈值不判定', () => {
  const f = detect(stripCode('!'.repeat(19)), limits)
  assert.equal(f.collapsed, false)
})

check('全角问号同样计入', () => {
  const f = detect(stripCode('？'.repeat(25)), limits)
  assert.equal(f.kind, 'punct')
  assert.equal(f.stats.punctChar, '？')
})

// 指标本身
check('measure 返回预期字段', () => {
  const m = measure('短句。')
  assert.equal(m.collapsed, false)
  assert.equal(typeof m.stats.maxDashRun, 'number')
  assert.equal(typeof m.stats.shortRepeatRatio, 'number')
})

console.log(`\n${passed} 项断言全部通过`)
