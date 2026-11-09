/**
 * 推理死循环防护 —— 装配层。
 *
 * 两条能力：
 *   实时  src/live.js    监听 reasoning 增量，命中阈值后注入收敛提醒（顾问式，不打断）
 *   事后  src/report.js  扫描会话存档，列出塌陷会话排行（工具 + HTTP 路由）
 *
 * 装配纪律（模板同款）：
 *   1. 可选服务判断存在性，缺一个不能把其他注册一起带走
 *   2. 所有注册放进 ctx.effect 并返回清理函数
 *   3. 工具注册 try/catch：宿主注册失败是静默的
 *   4. 不做「enabled=false 就 apply 早退」：工具与路由要始终可用
 *
 * @module dsh-doom-loop-guard
 */

import { VERSION } from './src/constants.js'
import { attachLive } from './src/live.js'
import { createPressureProjection } from './src/pressure.js'
import { createRoutes } from './src/routes.js'
import { loadSettings, resolveOptions, saveSettings, settingsPath } from './src/settings.js'
import { createSoundPlayer } from './src/sound.js'
import { createToolDefinition } from './src/tool.js'

/** Loader identity，与 cordis.patch.yml 的行 id 一致。 */
export const name = 'dsh-doom-loop-guard'

/** 必需服务：工具注册表 + 会话投影 + agent 注册表（后者缺失时截断降级为提醒）。 */
export const inject = ['tools', 'sessionProjections', 'agents']

export function apply (ctx, config) {
  const log = ctx.logger('doom-loop-guard')
  let options = loadSettings(log, resolveOptions(config))
  if (!options.enabled) log.info('实时预警已在设置中关闭，事后报告仍可用')

  // ── 上下文压力投影 ──────────────────────────────────────────────────────
  const projections = typeof ctx.sessionProjections?.register === 'function' ? ctx.sessionProjections : null
  if (projections) {
    ctx.effect(() => projections.register(createPressureProjection()))
  } else {
    log.warn('sessionProjections 不可用：上下文关联敏感度关闭，阈值固定')
  }

  // ── 实时预警与音效 ──────────────────────────────────────────────────────
  const sound = createSoundPlayer(log)
  const sink = { events: [] }
  ctx.effect(() => () => sound.dispose())
  ctx.effect(() => attachLive(ctx, () => options, log, projections, sound, sink))

  // ── 工具 ────────────────────────────────────────────────────────────────
  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    log.warn('tools 服务不可用：doom_loop_report 未注册')
  } else {
    ctx.effect(() => {
      try {
        const dispose = ctx.tools.register(createToolDefinition({ getOptions: () => options }))
        log.info('doom_loop_report tool registered')
        return dispose
      } catch (error) {
        log.warn(`tool registration failed: ${error instanceof Error ? error.message : String(error)}`)
        return () => {}
      }
    })
  }

  // ── HTTP 路由 ───────────────────────────────────────────────────────────
  if (typeof ctx.inject !== 'function') {
    log.warn('webServer 不可用：报告路由未注册')
  } else {
    ctx.inject(['webServer'], (wctx) => {
      if (!wctx || !wctx.webServer) {
        log.warn('webServer 服务未就绪：报告路由未注册')
        return
      }
      wctx.effect(() => {
        const routes = createRoutes({
          getOptions: () => options,
          setOptions: (next) => { options = next },
          persist: (next) => saveSettings(log, next),
          playSound: () => sound.play({ ...options, soundCooldownMs: 0 }),
          getEvents: () => sink.events,
          log
        })
        const guard = (handler) => async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            log.warn(`route failed: ${error instanceof Error ? error.message : String(error)}`)
            try {
              if (res.headersSent) {
                res.end()
              } else {
                res.writeHead(500, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: 'plugin internal error' }))
              }
            } catch { /* 连接已断 */ }
          }
        }
        const disposers = routes.map((route) => {
          try {
            return wctx.webServer.register({ ...route, handler: guard(route.handler) })
          } catch (error) {
            log.warn(`route register failed: ${route.path}: ${error instanceof Error ? error.message : String(error)}`)
            return () => {}
          }
        })
        return () => disposers.forEach((dispose) => dispose())
      })
    })
  }

  log.info(`ready v${VERSION} (settings=${settingsPath()})`)
}
