/**
 * 实时预警与处置：包装 llm/stream，逐 block 检测，按模式处置。
 *
 *   nudge   注入提醒（顾问式，不打断）——当前默认
 *   cut     主动截断：闭合块并以 stop 结束流，落盘内容只保留循环前部分，可选自动续跑
 *   observe 只记录日志
 *
 * 截断要点（来自 agent-loop 的实现细节）：assistant/message 的每个 block 取 block-end 的载荷，
 * 所以只要在切断时给出剪过的 block-end，落盘消息里就没有循环部分；原始流仍留在事件 stream 记录里。
 *
 * 上下文门槛：warnAbovePercent > 0 时，占用未达该百分比直接透传，不检测也不提醒。
 */

import { cutIndex, detect, stripCode } from './detect.js'
import { readPressure, scaleLimits, sensitivityFactor } from './pressure.js'

/** 两次检测之间的最小新增字符数，避免每个 token 都跑一次正则。 */
const CHECK_STEP = 200

/** 从命中结果里抽出要被禁用的循环片段。 */
function bannedOf (finding) {
  if (finding.kind === 'symbol') {
    return finding.stats.maxDashRun > 0 ? '——**（破折号/加粗交替填充）' : '（（（（（（（连续左括号）'
  }
  return finding.stats.worstSentence || '（重复短句）'
}

function detailWithPressure (finding, percent) {
  return percent === null || percent === undefined
    ? finding.detail
    : `${finding.detail}；上下文已占用 ${percent}%`
}

/** 被动提示词：告诉模型停下并禁止再出现这些片段。 */
function nudgeText (options, finding, percent) {
  const template = typeof options.reminderText === 'string' && options.reminderText
    ? options.reminderText
    : '【Doom Loop Guard】检测到输出在原地重复：{detail}。请停止重复，先复述问题，再给出单一行动或提问。'
  const base = template
    .replaceAll('{kind}', finding.kind === 'symbol' ? '符号崩坏' : '低信息循环')
    .replaceAll('{detail}', detailWithPressure(finding, percent))
  if (!options.banList) return base
  return `${base}\n下一段输出禁止再次出现：${bannedOf(finding)}`
}

/** 主动截断后在会话里留下的说明。 */
function cutText (options, finding, cut) {
  const ban = options.banList ? `；接下来避免再次出现：${bannedOf(finding)}` : ''
  return `【Doom Loop Guard】输出在第 ${cut} 字符处开始连续重复，本次已截断${ban}。` +
    '请直接给出当前结论与下一步行动，不要重新展开推导。'
}

/**
 * @param {import('cordis').Context} ctx 插件上下文
 * @param {() => object} getOptions 读取当前生效设置
 * @param {{info:Function,warn:Function}} log
 * @param {object} [projections] 会话投影服务（缺省时不读上下文占用）
 * @returns {() => void} 卸载函数
 */
export function attachLive (ctx, getOptions, log, projections, sound, sink, notifier) {
  const states = new WeakMap()
  const events = sink && Array.isArray(sink.events) ? sink.events : []
  const record = (entry) => {
    try {
      events.unshift({ at: Date.now(), ...entry })
      if (events.length > 20) events.pop()
    } catch { /* 诊断不参与主流程 */ }
  }
  const stateOf = (agent) => {
    let s = states.get(agent)
    if (s === undefined) {
      s = { consecutiveCuts: 0 }
      states.set(agent, s)
    }
    return s
  }
  const agents = ctx.agents

  /** 截断后等回合真正结束再续跑。 */
  /** 截断后等回合真正结束再续跑；期间若已有新请求，本次续跑作废。 */
  function scheduleResume (agent, log, generation) {
    if (!agent || typeof agent.whenIdle !== 'function' || typeof agent.followup !== 'function') return
    let idle
    try {
      idle = agent.whenIdle()
    } catch {
      return
    }
    Promise.resolve(idle).then(() => {
      if (generation !== requestGeneration) return
      if (agent.inbox && agent.inbox.hasPending) return
      agent.followup({
        content: [{ type: 'text', text: '继续。上一段输出因连续重复被截断，请直接给出结论与下一步行动。' }],
        source: { kind: 'dsh-doom-loop-guard', form: 'notice', summary: '已截断循环，继续' }
      })
      log.info('resumed after cut')
    }).catch((error) => {
      log.warn(`resume failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 请求代数：cut 后若已有新请求，续跑作废。 */
  let requestGeneration = 0

  const off = ctx.on('llm/stream', (options, next) => {
    try {
      const sessionId = options && options.sessionId
      const generation = ++requestGeneration
      if (!sessionId) return next()

      const settings = getOptions()
      if (!settings.enabled) return next()

      const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
      const pressure = agent ? readPressure(projections, agent.session) : null
      const percent = pressure ? pressure.percent : null
      const mode = settings.intervention || 'nudge'

      if (settings.warnAbovePercent > 0 && (percent === null || percent < settings.warnAbovePercent)) {
        return next()
      }

      const factor = sensitivityFactor(percent, settings)
      const limits = scaleLimits(settings, factor)

      return (async function* guarded () {
        const open = new Map()
        const warned = new Set()
        let finished = false

        for await (const chunk of next()) {
          const type = chunk && chunk.type

          if (type === 'block-start') {
            open.set(chunk.index, { kind: chunk.blockType, text: '', checked: 0 })
          } else if (type === 'block-end') {
            open.delete(chunk.index)
          } else if (type === 'finish') {
            finished = true
          }

          let hit = null
          let hitIndex = -1
          if (type === 'reasoning-delta' || type === 'text-delta') {
            const block = open.get(chunk.index)
            if (block && (block.kind === 'reasoning' || block.kind === 'text')) {
              block.text += chunk.text
              if (block.text.length - block.checked >= CHECK_STEP) {
                block.checked = block.text.length
                const tail = block.text.length > settings.windowChars * 2
                  ? block.text.slice(-settings.windowChars)
                  : block.text
                const finding = detect(stripCode(tail), limits)
                if (finding.collapsed && finding.confidence === 'high' && !warned.has(finding.kind)) {
                  hit = finding
                  hitIndex = chunk.index
                }
              }
            }
          }

          if (!hit) {
            yield chunk
            continue
          }

          warned.add(hit.kind)
          if (sound) {
            try {
              sound.play(settings)
            } catch (error) {
              log.warn(`sound failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          if (notifier) {
            try {
              const kindLabel = hit.kind === 'symbol' ? '符号填充' : '短句循环'
              const modeLabel = mode === 'observe' ? '仅记录' : mode === 'cut' ? '已截断' : '已注入提醒'
              notifier.notify(settings, { title: '推理死循环', body: `${kindLabel} · ${modeLabel}` })
            } catch (error) {
              log.warn(`notify failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          }

          if (mode === 'observe') {
            record({ kind: hit.kind, detail: hit.detail, mode: 'observe', agent: Boolean(agent), inject: 'none', percent })
            log.info(`doom loop observed (${hit.kind}): ${hit.detail}`)
            yield chunk
            continue
          }

          if (mode === 'nudge') {
            const text = nudgeText(settings, hit, percent)
            let injected = 'no-agent'
            if (agent) {
              try {
                agent.inject({
                  content: [{ type: 'text', text }],
                  source: { kind: 'dsh-doom-loop-guard', form: 'notice', summary: text.slice(0, 120) }
                })
                injected = 'ok'
              } catch (error) {
                injected = 'error'
                log.warn(`inject failed: ${error instanceof Error ? error.message : String(error)}`)
              }
            }
            record({ kind: hit.kind, detail: hit.detail, mode: 'nudge', agent: Boolean(agent), inject: injected, percent })
            log.info(`doom loop nudged (${hit.kind}): ${hit.detail}`)
            yield chunk
            continue
          }

          // ── cut ────────────────────────────────────────────────────────
          const toolOpen = [...open.values()].some((b) => b.kind !== 'text' && b.kind !== 'reasoning')
          if (toolOpen || !agent) {
            log.warn('cut skipped: open tool call or agent unavailable')
            yield chunk
            continue
          }
          const state = stateOf(agent)
          if (state.consecutiveCuts >= settings.maxConsecutiveCuts) {
            const text = nudgeText(settings, hit, percent)
            try {
              agent.inject({ content: [{ type: 'text', text }], source: { kind: 'dsh-doom-loop-guard' } })
            } catch { /* 宿主演进时忽略 */ }
            record({ kind: hit.kind, detail: hit.detail, mode: 'nudge-cap', agent: Boolean(agent), inject: 'none', percent })
            log.warn(`cut cap reached (${state.consecutiveCuts}), falling back to nudge`)
            yield chunk
            continue
          }
          state.consecutiveCuts++

          const block = open.get(hitIndex)
          const windowFrom = block.text.length > settings.windowChars * 2
            ? block.text.length - settings.windowChars
            : 0
          const cut = cutIndex(block.text, hit, windowFrom)
          const kept = block.text.slice(0, cut).replace(/\s+$/, '')

          const tail = []
          for (const [index, b] of open) {
            const text = index === hitIndex ? kept : b.text
            tail.push({ type: 'block-end', index, block: { type: b.kind, text } })
          }
          tail.push({ type: 'finish', reason: { kind: 'stop' } })

          if (settings.autoResume) scheduleResume(agent, log, generation)
          record({ kind: hit.kind, detail: hit.detail, mode: 'cut', agent: Boolean(agent), inject: 'none', percent, cut })
          log.info(`doom loop cut (${hit.kind}) at ${cut}: ${hit.detail}`)
          for (const c of tail) yield c
          return
        }

        if (finished && agent) stateOf(agent).consecutiveCuts = 0
      })()
    } catch (error) {
      log.warn(`llm/stream wrapper failed: ${error instanceof Error ? error.message : String(error)}`)
      return next()
    }
  })

  return () => {
    if (typeof off === 'function') off()
  }
}
