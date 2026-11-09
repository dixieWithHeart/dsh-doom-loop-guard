/**
 * 设置读写：patch 默认值 → 设置文件覆盖 → 内存生效。
 * 与项目内其他插件同款（dsh-context-usage / dsh-notify-sound）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DEFAULTS, PRESETS, SETTINGS_FILENAME } from './constants.js'

const BOOLEAN_KEYS = ['enabled', 'remindOncePerAttempt', 'autoResume', 'banList', 'soundEnabled']
const NUMBER_KEYS = {
  warnAbovePercent: { min: 0, max: 100, decimals: 0 },
  soundCooldownMs: { min: 0, max: 600000, decimals: 0 },
  reportDays: { min: 1, max: 3650, decimals: 0 },
  reportLimit: { min: 1, max: 200, decimals: 0 }
}
const STRING_KEYS = ['soundPath']
const ENUM_KEYS = { intervention: ['nudge', 'cut', 'observe'], preset: ['relaxed', 'standard', 'sensitive'] }

export function settingsPath () {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, SETTINGS_FILENAME)
}

/** 合并 patch 配置与默认值。 */
export function resolveOptions (config) {
  const source = config && typeof config === 'object' ? config : {}
  const presetName = PRESETS[source.preset] ? source.preset : DEFAULTS.preset
  const out = { ...DEFAULTS, ...PRESETS[presetName], preset: presetName }
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'preset') continue
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/** 只接受已知字段与合法范围，其余忽略。 */
export function sanitize (patch, current) {
  const next = { ...current }
  if (!patch || typeof patch !== 'object') return next
  for (const key of BOOLEAN_KEYS) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key]
  }
  for (const [key, range] of Object.entries(NUMBER_KEYS)) {
    const value = Number(patch[key])
    if (!Number.isFinite(value)) continue
    const clamped = Math.min(range.max, Math.max(range.min, value))
    next[key] = range.decimals > 0
      ? Number(clamped.toFixed(range.decimals))
      : Math.round(clamped)
  }
  for (const key of STRING_KEYS) {
    if (typeof patch[key] === 'string' && patch[key].length <= 2000) next[key] = patch[key]
  }
  for (const [key, allowed] of Object.entries(ENUM_KEYS)) {
    if (typeof patch[key] === 'string' && allowed.includes(patch[key])) next[key] = patch[key]
  }
  // 等级变化时套用对应阈值组；阈值本身不接受设置文件直接写
  if (next.preset !== current.preset && PRESETS[next.preset]) {
    Object.assign(next, PRESETS[next.preset])
  }
  return next
}

export function loadSettings (log, options) {
  const file = settingsPath()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return sanitize(raw, options)
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      log.warn(`settings unreadable: ${error.message}`)
    }
    return { ...options }
  }
}

export function saveSettings (log, settings) {
  const file = settingsPath()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8')
    return true
  } catch (error) {
    log.warn(`settings write failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
