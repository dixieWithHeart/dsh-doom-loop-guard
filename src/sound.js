/**
 * 循环音效：命中时用独立子进程播放，不阻塞 Host 事件循环。
 *
 * Windows 走 WPF MediaPlayer（powershell.exe -STA），借系统解码器播 MP3；
 * 路径经 -EncodedCommand 传递，中文/空格路径都安全。非 Windows 退回 afplay / paplay。
 * 冷却时间由调用方配置，避免连续命中时叠音。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件内置音频（随包分发）。 */
const ASSET = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'assets', 'loop-alert.mp3')

function quotePowerShell (text) {
  return `'${String(text).replace(/'/g, "''")}'`
}

/** 播完才退出进程，避免音效被截断；时长未知时最多等 5 秒。 */
function mediaPlayerScript (file) {
  return [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName PresentationCore',
    '$player = New-Object System.Windows.Media.MediaPlayer',
    `$player.Open([Uri]::new(${quotePowerShell(file)}))`,
    'for ($i = 0; $i -lt 40 -and -not $player.NaturalDuration.HasTimeSpan; $i++) { Start-Sleep -Milliseconds 50 }',
    '$duration = 0; if ($player.NaturalDuration.HasTimeSpan) { $duration = $player.NaturalDuration.TimeSpan.TotalSeconds }',
    '$player.Play()',
    '$limit = if ($duration -gt 0) { [math]::Min(600, [math]::Ceiling($duration * 10) + 20) } else { 50 }',
    'for ($i = 0; $i -lt $limit; $i++) { Start-Sleep -Milliseconds 100; if ($duration -gt 0 -and $player.Position.TotalSeconds -ge $duration) { break } }',
    '$player.Close()'
  ].join(';')
}

/** 解析音频路径：配置了外部路径且存在就用它，否则用内置资源。 */
export function resolveSoundPath (options) {
  const custom = options && typeof options.soundPath === 'string' ? options.soundPath.trim() : ''
  if (custom && existsSync(custom)) return custom
  return existsSync(ASSET) ? ASSET : null
}

/** 冷却判定：距离上次播放不足 cooldownMs 就不再播。 */
export function shouldPlay (now, lastPlayed, cooldownMs) {
  const gap = Math.max(0, Number(cooldownMs) || 0)
  return now - lastPlayed >= gap
}

/** PowerShell 参数（-EncodedCommand，UTF-16LE + Base64）。 */
export function buildPlayerArgs (file) {
  const encoded = Buffer.from(mediaPlayerScript(file), 'utf16le').toString('base64')
  return ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
}

/**
 * @param {{warn:Function}} log
 * @param {{spawn?:Function, platform?:string}} [deps] 测试可注入
 */
export function createSoundPlayer (log, deps = {}) {
  const spawnFn = deps.spawn || spawn
  const platform = deps.platform || process.platform
  const children = new Set()
  let lastPlayed = 0

  function play (options) {
    if (!options || options.soundEnabled === false) return false
    const now = Date.now()
    if (!shouldPlay(now, lastPlayed, options.soundCooldownMs)) return false
    const file = resolveSoundPath(options)
    if (!file) {
      log.warn('sound skipped: audio file not found')
      return false
    }
    lastPlayed = now
    let command = 'paplay'
    let args = [file]
    if (platform === 'win32') {
      command = 'powershell.exe'
      args = buildPlayerArgs(file)
    } else if (platform === 'darwin') {
      command = 'afplay'
    }
    try {
      const child = spawnFn(command, args, { stdio: 'ignore', windowsHide: true })
      children.add(child)
      const done = () => { children.delete(child) }
      if (typeof child.on === 'function') {
        child.on('error', (error) => {
          done()
          log.warn(`sound failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        child.on('exit', done)
      }
      return true
    } catch (error) {
      log.warn(`sound spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function dispose () {
    for (const child of children) {
      try { child.kill() } catch { /* 已退出 */ }
    }
    children.clear()
  }

  return { play, dispose, lastPlayedAt: () => lastPlayed, assetPath: ASSET }
}
