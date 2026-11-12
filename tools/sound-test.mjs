// 音效契约测试：路径解析、冷却、播放参数、开关
import assert from 'node:assert/strict'

import { buildPlayerArgs, createSoundPlayer, resolveSoundPath, shouldPlay } from '../src/sound.js'

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
  const player = createSoundPlayer(log, { spawn, platform })
  return { calls, player }
}

check('内置默认音色（pulse）存在且可解析', () => {
  const path = resolveSoundPath({ soundset: 'pulse' })
  assert.ok(path && path.endsWith('pulse.wav'))
})

check('六个内置音色都能解析到对应文件', () => {
  for (const set of ['pulse', 'triple', 'rise', 'sting', 'ticks', 'alarm']) {
    const path = resolveSoundPath({ soundset: set })
    assert.ok(path && path.endsWith(`${set}.wav`), set)
  }
})

check('自定义路径不存在时退回所选内置音色', () => {
  const path = resolveSoundPath({ soundPath: 'Z:\\nope\\missing.mp3', soundset: 'triple' })
  assert.ok(path && path.endsWith('triple.wav'))
})

check('非法音色名不参与路径拼接', () => {
  const path = resolveSoundPath({ soundset: '../../evil' })
  assert.ok(path && !path.includes('evil'))
})

check('冷却判定', () => {
  assert.equal(shouldPlay(1000, 0, 5000), false)
  assert.equal(shouldPlay(6000, 1000, 5000), true)
  assert.equal(shouldPlay(1000, 1000, 0), true)
})

check('播放参数是 -EncodedCommand 且含文件路径', () => {
  const args = buildPlayerArgs('C:\\临时 目录\\a.mp3')
  assert.ok(args.includes('-EncodedCommand'))
  assert.ok(args.includes('-STA'))
  const encoded = args[args.indexOf('-EncodedCommand') + 1]
  const script = Buffer.from(encoded, 'base64').toString('utf16le')
  assert.ok(script.includes('C:\\临时 目录\\a.mp3'))
  assert.ok(script.includes('MediaPlayer'))
})

check('首次播放会 spawn 一次', () => {
  const { calls, player } = harness()
  const played = player.play({ soundEnabled: true, soundCooldownMs: 0 })
  assert.equal(played, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'powershell.exe')
})

check('冷却期内不重复播放', () => {
  const { calls, player } = harness()
  player.play({ soundEnabled: true, soundCooldownMs: 60000 })
  const second = player.play({ soundEnabled: true, soundCooldownMs: 60000 })
  assert.equal(second, false)
  assert.equal(calls.length, 1)
})

check('关闭开关后不播放', () => {
  const { calls, player } = harness()
  const played = player.play({ soundEnabled: false, soundCooldownMs: 0 })
  assert.equal(played, false)
  assert.equal(calls.length, 0)
})

check('非 Windows 走 afplay', () => {
  const { calls, player } = harness('darwin')
  player.play({ soundEnabled: true, soundCooldownMs: 0 })
  assert.equal(calls[0].cmd, 'afplay')
})

check('spawn 抛错不影响调用方', () => {
  const player = createSoundPlayer(log, {
    spawn: () => { throw new Error('boom') },
    platform: 'win32'
  })
  const played = player.play({ soundEnabled: true, soundCooldownMs: 0 })
  assert.equal(played, false)
  assert.ok(warns.some((w) => w.includes('sound spawn failed')))
})

console.log(`\n${passed} 项音效断言通过`)
