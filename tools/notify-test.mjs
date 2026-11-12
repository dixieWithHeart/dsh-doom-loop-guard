// 系统通知契约测试：开关、冷却、平台命令、XML 转义、异常隔离
import assert from 'node:assert/strict'

import { buildNotifyArgs, createNotifier, toastScript } from '../src/notify.js'

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

const warns = []
const log = { warn: (m) => warns.push(m) }

function harness (platform = 'win32') {
  const calls = []
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return { on: () => {}, kill: () => {} }
  }
  const notifier = createNotifier(log, { spawn, platform })
  return { calls, notifier }
}

check('默认开启时 spawn 一次', () => {
  const { calls, notifier } = harness()
  const sent = notifier.notify({ notifyEnabled: true, soundCooldownMs: 0 }, { title: '推理死循环', body: '符号填充 · 已注入提醒' })
  assert.equal(sent, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'powershell.exe')
})

check('开关关闭时不发通知', () => {
  const { calls, notifier } = harness()
  assert.equal(notifier.notify({ notifyEnabled: false, soundCooldownMs: 0 }, { title: 't', body: 'b' }), false)
  assert.equal(calls.length, 0)
})

check('冷却期内不重复', () => {
  const { calls, notifier } = harness()
  notifier.notify({ notifyEnabled: true, soundCooldownMs: 60000 }, { title: 't', body: 'b' })
  notifier.notify({ notifyEnabled: true, soundCooldownMs: 60000 }, { title: 't', body: 'b' })
  assert.equal(calls.length, 1)
})

check('Windows 参数是 -EncodedCommand 且含标题与正文', () => {
  const { args } = buildNotifyArgs('win32', '推理死循环', '符号填充 · 已注入提醒')
  assert.ok(args.includes('-EncodedCommand'))
  const encoded = args[args.indexOf('-EncodedCommand') + 1]
  const script = Buffer.from(encoded, 'base64').toString('utf16le')
  assert.ok(script.includes('ToastNotificationManager'))
  assert.ok(script.includes('com.deepseek.dsh'))
  assert.ok(script.includes('推理死循环'))
})

check('标题正文做 XML 转义', () => {
  const script = toastScript('app', '<a>', '&b')
  assert.ok(script.includes('&lt;a&gt;'))
  assert.ok(script.includes('&amp;b'))
})

check('非 Windows 走 osascript', () => {
  const { command, args } = buildNotifyArgs('darwin', 'title', 'body')
  assert.equal(command, 'osascript')
  assert.ok(args.join(' ').includes('display notification'))
})

check('Linux 走 notify-send', () => {
  const { command, args } = buildNotifyArgs('linux', 'title', 'body')
  assert.equal(command, 'notify-send')
  assert.deepEqual(args, ['title', 'body'])
})

check('正文截断到 200 字', () => {
  const { calls, notifier } = harness()
  notifier.notify({ notifyEnabled: true, soundCooldownMs: 0 }, { title: 't', body: 'x'.repeat(500) })
  const encoded = calls[0].args[calls[0].args.indexOf('-EncodedCommand') + 1]
  const script = Buffer.from(encoded, 'base64').toString('utf16le')
  assert.ok(!script.includes('x'.repeat(201)))
})

check('spawn 抛错不影响调用方', () => {
  const notifier = createNotifier(log, { platform: 'win32', spawn: () => { throw new Error('boom') } })
  assert.equal(notifier.notify({ notifyEnabled: true, soundCooldownMs: 0 }, { title: 't', body: 'b' }), false)
})

check('缺少 payload 时用默认标题', () => {
  const { calls, notifier } = harness()
  notifier.notify({ notifyEnabled: true, soundCooldownMs: 0 })
  const encoded = calls[0].args[calls[0].args.indexOf('-EncodedCommand') + 1]
  const script = Buffer.from(encoded, 'base64').toString('utf16le')
  assert.ok(script.includes('推理死循环'))
})

console.log(`\n${passed} 项通知断言通过`)
