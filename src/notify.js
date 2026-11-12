/**
 * 系统通知：命中时弹一条桌面通知（Windows Toast / macOS / Linux）。
 *
 * 与 dsh-notify-chime 同一套做法：Windows 用 WinRT ToastNotificationManager，
 * appId 用 DSH 桌面版的 `com.deepseek.dsh`（只有已注册的 AppUserModelID 才会弹横幅）；
 * 其它平台走 osascript / notify-send。全部经独立子进程，不阻塞 Host 事件循环。
 *
 * 通知失败只记日志，不影响检测与注入。
 */

import { spawn } from 'node:child_process'

/** DSH 桌面版的 AppUserModelID：决定通知来源，未注册的 ID 只进通知中心。 */
const APP_ID = 'com.deepseek.dsh'

function quotePowerShell (text) {
  return `'${String(text).replace(/'/g, "''")}'`
}

function escapeXml (text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Windows Toast 脚本（WinRT）。 */
export function toastScript (appId, title, body) {
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual></toast>`
  return [
    "$ErrorActionPreference='Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml(${quotePowerShell(xml)})`,
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${quotePowerShell(appId)}).Show($toast)`,
  ].join(';')
}

/** 生成平台对应的通知命令与参数（测试直接断言这里）。 */
export function buildNotifyArgs (platform, title, body) {
  if (platform === 'win32') {
    const encoded = Buffer.from(toastScript(APP_ID, title, body), 'utf16le').toString('base64')
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    }
  }
  if (platform === 'darwin') {
    const esc = (text) => String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return { command: 'osascript', args: ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`] }
  }
  return { command: 'notify-send', args: [title, body] }
}

/**
 * @param {{warn:Function}} log
 * @param {{spawn?:Function, platform?:string}} [deps] 测试可注入
 */
export function createNotifier (log, deps = {}) {
  const spawnFn = deps.spawn || spawn
  const platform = deps.platform || process.platform
  const children = new Set()
  let lastAt = 0

  function notify (options, payload) {
    if (!options || options.notifyEnabled === false) return false
    const now = Date.now()
    const cooldown = Math.max(0, Number(options.notifyCooldownMs ?? options.soundCooldownMs) || 0)
    if (now - lastAt < cooldown) return false
    const title = (payload && payload.title) || '推理死循环'
    const body = String((payload && payload.body) || '').slice(0, 200)
    lastAt = now
    try {
      const { command, args } = buildNotifyArgs(platform, title, body)
      const child = spawnFn(command, args, { stdio: 'ignore', windowsHide: true })
      children.add(child)
      const done = () => { children.delete(child) }
      if (child && typeof child.on === 'function') {
        child.on('error', (error) => {
          done()
          log.warn(`notify failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        child.on('exit', done)
      }
      return true
    } catch (error) {
      log.warn(`notify spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function dispose () {
    for (const child of children) {
      try { child.kill() } catch { /* 已退出 */ }
    }
    children.clear()
  }

  return { notify, dispose, lastNotifiedAt: () => lastAt }
}
