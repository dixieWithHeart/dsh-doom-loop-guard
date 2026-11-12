// 上下文敏感度契约测试：系数、阈值缩放、投影读取
import assert from 'node:assert/strict'

import { DEFAULTS } from '../src/constants.js'
import { PRESSURE_KEY, createPressureProjection, readPressure, scaleLimits, sensitivityFactor } from '../src/pressure.js'
import { doomOf } from '../src/report.js'

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

check('门槛为 0 时不收紧', () => {
  assert.equal(sensitivityFactor(95, { ...DEFAULTS, warnAbovePercent: 0 }), 1)
})

check('门槛之后线性收紧且封顶', () => {
  const opts = { ...DEFAULTS, warnAbovePercent: 50 }
  assert.equal(sensitivityFactor(50, opts), 1)
  const f80 = sensitivityFactor(80, opts)
  assert.ok(f80 > 1 && f80 < 1.001 + opts.pressureBoostMax)
  const f100 = sensitivityFactor(100, opts)
  assert.equal(Number(f100.toFixed(3)), Number((1 + opts.pressureBoostMax).toFixed(3)))
})

check('收紧幅度为 0 时不收紧', () => {
  assert.equal(sensitivityFactor(100, { ...DEFAULTS, warnAbovePercent: 50, pressureBoostMax: 0 }), 1)
})

check('scaleLimits 收紧阈值、放宽间隔', () => {
  const scaled = scaleLimits(DEFAULTS, 1.6)
  assert.ok(scaled.maxDashRun < DEFAULTS.maxDashRun)
  assert.ok(scaled.maxParenRun < DEFAULTS.maxParenRun)
  assert.ok(scaled.shortSentenceRepeat < DEFAULTS.shortSentenceRepeat)
  assert.ok(scaled.shortRepeatRatio < DEFAULTS.shortRepeatRatio)
  assert.ok(scaled.maxRepeatGap > DEFAULTS.maxRepeatGap)
})

check('scaleLimits 不越下限', () => {
  const scaled = scaleLimits({ ...DEFAULTS, maxDashRun: 20, maxParenRun: 4, shortSentenceRepeat: 3 }, 10)
  assert.ok(scaled.maxDashRun >= 20)
  assert.ok(scaled.maxParenRun >= 4)
  assert.ok(scaled.shortSentenceRepeat >= 3)
})

check('投影折叠 contextWindow 与 usage', () => {
  const p = createPressureProjection()
  let state = p.init()
  assert.equal(p.key, PRESSURE_KEY)
  state = p.apply(state, { type: 'request/context', data: { contextWindow: 200000 } })
  assert.equal(state.contextWindow, 200000)
  state = p.apply(state, { type: 'assistant/message', data: { usage: { inputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 100 } } })
  assert.equal(state.pressureTokens, 1600)
})

check('无关事件返回同一引用', () => {
  const p = createPressureProjection()
  const state = p.init()
  assert.equal(p.apply(state, { type: 'tool/result' }), state)
  assert.equal(p.apply(state, null), state)
})

check('readPressure 计算占用率', () => {
  const projections = {
    stateOf: (session, key) => {
      assert.equal(key, PRESSURE_KEY)
      return { pressureTokens: 150000, contextWindow: 200000 }
    }
  }
  const p = readPressure(projections, {})
  assert.equal(p.percent, 75)
})

check('readPressure 缺数据返回 null', () => {
  assert.equal(readPressure(null, {}), null)
  assert.equal(readPressure({ stateOf: () => null }, {}), null)
})

check('doom 分公式', () => {
  assert.equal(doomOf([], 100, 0), 0)
  assert.equal(doomOf([{ confidence: 'high' }], 200, 1), 2)
  assert.equal(doomOf(Array.from({ length: 10 }, () => ({ confidence: 'high' })), 10, 3), 100)
  // 中信号按 0.4 计：1 条 low 在 10 条推理里 → 0.04 * 400 = 16
  assert.equal(doomOf([{ confidence: 'low' }], 10, 0), 16)
  assert.equal(doomOf([], 0, 0), 0)
})

console.log(`\n${passed} 项上下文敏感度断言通过`)
