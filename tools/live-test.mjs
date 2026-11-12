// 实时链路契约测试：mock llm/stream 与 agent，验证三种处置模式、上下文门槛与截断落盘内容
import assert from 'node:assert/strict'

import { DEFAULTS } from '../src/constants.js'
import { attachLive } from '../src/live.js'

let passed = 0
// 必须是 async 并 await 用例：否则异步断言失败时先打印 ok、再以未捕获异常崩溃，
// 表现为「全部通过」之后突然报错（本文件 2026-11-12 实测踩到）
async function check (name, fn) {
  try {
    await fn()
    passed++
    console.log(`ok  ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

function makeHarness (settings, chunks) {
  const logs = []
  const injected = []
  const followups = []
  const notified = []
  let wrapper = null

  const agent = {
    session: { id: 'session-x' },
    inbox: { hasPending: false },
    inject: (msg) => injected.push(msg),
    followup: (msg) => followups.push(msg),
    whenIdle: () => Promise.resolve()
  }

  const ctx = {
    agents: { get: () => agent },
    on (event, fn) {
      if (event === 'llm/stream') wrapper = fn
      return () => { wrapper = null }
    }
  }

  const log = {
    info: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push('WARN ' + a.join(' '))
  }

  // 基线：测试用例默认全程检测，门槛相关的用例自己传 warnAbovePercent
  // notifier 用测试替身：只记录调用，不真的弹窗
  const notifier = { notify: (options, payload) => { notified.push({ options, payload }); return true } }
  attachLive(ctx, () => ({ ...DEFAULTS, warnAbovePercent: 0, ...settings }), log, null, null, null, notifier)

  const options = { sessionId: 'session-x' }
  const stream = wrapper(options, () => (async function* () {
    for (const c of chunks) yield c
  })())

  return { logs, injected, followups, notified, stream, agent }
}

async function collect (iter) {
  const out = []
  for await (const c of iter) out.push(c)
  return out
}

function loopChunks (times) {
  const chunks = [{ type: 'block-start', index: 0, blockType: 'reasoning' }]
  for (let i = 0; i < times; i++) {
    chunks.push({ type: 'reasoning-delta', index: 0, text: '好。执行。' })
  }
  chunks.push({ type: 'block-end', index: 0 })
  chunks.push({ type: 'finish', reason: { kind: 'stop' } })
  return chunks
}

async function run () {
  await check('observe 模式只记录、不改流', async () => {
    const h = makeHarness({ intervention: 'observe' }, loopChunks(200))
    const out = await collect(h.stream)
    assert.ok(out.length > 10)
    assert.equal(h.injected.length, 0)
    assert.ok(h.logs.some((l) => l.includes('observed')))
  })

  await check('nudge 模式注入提醒并放行原流', async () => {
    const h = makeHarness({ intervention: 'nudge' }, loopChunks(200))
    const out = await collect(h.stream)
    assert.equal(h.injected.length, 1)
    assert.ok(h.injected[0].content[0].text.includes('禁止'))
    assert.ok(out.some((c) => c.type === 'finish'))
  })

  await check('命中时发系统通知，正文带处置方式', async () => {
    const h = makeHarness({ intervention: 'nudge', notifyEnabled: true }, loopChunks(200))
    await collect(h.stream)
    assert.equal(h.notified.length, 1)
    assert.equal(h.notified[0].payload.title, '推理死循环')
    assert.ok(h.notified[0].payload.body.includes('已注入提醒'))
  })

  await check('observe 模式的通知正文为「仅记录」', async () => {
    const h = makeHarness({ intervention: 'observe', notifyEnabled: true }, loopChunks(200))
    await collect(h.stream)
    assert.equal(h.notified.length, 1)
    assert.ok(h.notified[0].payload.body.includes('仅记录'))
  })

  await check('cut 模式截断并以 stop 结束', async () => {
    const h = makeHarness({ intervention: 'cut', autoResume: false }, loopChunks(200))
    const out = await collect(h.stream)
    const finish = out.find((c) => c.type === 'finish')
    const ends = out.filter((c) => c.type === 'block-end')
    assert.equal(finish.reason.kind, 'stop')
    assert.equal(ends.length, 1)
    assert.ok(ends[0].block.text.length < 200 * 5)
    assert.equal(h.injected.length, 0)
  })

  await check('cut 模式在循环起点剪断落盘内容', async () => {
    const chunks = [{ type: 'block-start', index: 0, blockType: 'reasoning' }]
    chunks.push({ type: 'reasoning-delta', index: 0, text: '先确认目录结构，再读规范。' })
    for (let i = 0; i < 200; i++) chunks.push({ type: 'reasoning-delta', index: 0, text: '好。执行。' })
    chunks.push({ type: 'block-end', index: 0 })
    chunks.push({ type: 'finish', reason: { kind: 'stop' } })
    const h = makeHarness({ intervention: 'cut', autoResume: false }, chunks)
    const out = await collect(h.stream)
    const end = out.find((c) => c.type === 'block-end')
    assert.ok(end.block.text.includes('先确认目录结构'))
    assert.ok(!end.block.text.includes('好。执行。好。执行。好。执行。好。执行。'))
  })

  await check('cut 模式自动续跑', async () => {
    const h = makeHarness({ intervention: 'cut', autoResume: true }, loopChunks(200))
    await collect(h.stream)
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(h.followups.length, 1)
    assert.ok(h.followups[0].content[0].text.includes('继续'))
  })

  await check('上下文门槛未达到时完全透传', async () => {
    const h = makeHarness({ intervention: 'nudge', warnAbovePercent: 80 }, loopChunks(200))
    // 没有投影服务 → percent 为 null → 视为未达门槛
    const out = await collect(h.stream)
    assert.equal(h.injected.length, 0)
    assert.ok(out.length > 10)
  })

  await check('半截工具调用时不做截断', async () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'tool-call' }
    ]
    for (let i = 0; i < 200; i++) chunks.push({ type: 'reasoning-delta', index: 0, text: '好。执行。' })
    chunks.push({ type: 'finish', reason: { kind: 'stop' } })
    const h = makeHarness({ intervention: 'cut', autoResume: false }, chunks)
    const out = await collect(h.stream)
    assert.ok(out.some((c) => c.type === 'reasoning-delta'))
    assert.ok(h.logs.some((l) => l.includes('cut skipped')))
  })

  await check('enabled=false 时直接透传', async () => {
    const h = makeHarness({ enabled: false, intervention: 'nudge' }, loopChunks(200))
    await collect(h.stream)
    assert.equal(h.injected.length, 0)
  })

  await check('开头出现过同样短句时，只剪尾部循环', async () => {
    const head = '好。执行。好。执行。好。执行。然后开始读文件。'
    const middle = '读文件，检查调用点，确认契约。'.repeat(800)
    const tail = '好。执行。'.repeat(200)
    const chunks = [{ type: 'block-start', index: 0, blockType: 'reasoning' }]
    for (const seg of [head, middle, tail]) chunks.push({ type: 'reasoning-delta', index: 0, text: seg })
    chunks.push({ type: 'block-end', index: 0 })
    chunks.push({ type: 'finish', reason: { kind: 'stop' } })
    const h = makeHarness({ intervention: 'cut', autoResume: false }, chunks)
    const out = await collect(h.stream)
    const end = out.find((c) => c.type === 'block-end')
    assert.ok(end.block.text.startsWith('好。执行。好。执行。好。执行。然后开始读文件。'), '开头内容应保留')
    assert.ok(end.block.text.length > 5000, '中段正常内容应保留')
    assert.ok(!end.block.text.includes('好。执行。好。执行。好。执行。好。执行。'), '尾部循环应被剪掉')
  })

  console.log(`\n${passed} 项实时链路断言通过`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
