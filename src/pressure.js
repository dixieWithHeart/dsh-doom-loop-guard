/**
 * 上下文压力：从会话日志派生当前上下文占用，用于在会话后段提高预警敏感度。
 *
 * 依据：校准数据里三处循环起点分别在会话 74% / 71% / 96% 位置，
 * 说明循环是上下文累积的结果。loop-rescue 没有这个维度。
 *
 * 数据来自会话事件（与 dsh-context-usage 同源）：
 *   · `request/context` 携带 contextWindow
 *   · `assistant/message` 携带 usage（input + cacheRead + cacheWrite）
 */

export const PRESSURE_KEY = 'doomLoopPressure'

const stateSchema = {
  parse (value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('doom-loop-guard: projection state must be a plain object')
    }
    return value
  }
}

export function initialPressure () {
  return { pressureTokens: null, contextWindow: null, turn: null }
}

/** 由日志折叠出的每会话压力状态（纯函数、同步、无关事件返回同一引用）。 */
export function createPressureProjection () {
  return {
    key: PRESSURE_KEY,
    stateVersion: 1,
    stateSchema,
    init: () => initialPressure(),
    apply: (state, event) => {
      if (event === null || typeof event !== 'object') return state

      if (event.type === 'turn/start') {
        const t = event.data && event.data.turn
        if (typeof t !== 'number' || t === state.turn) return state
        return { ...state, turn: t }
      }

      if (event.type === 'request/context') {
        const w = event.data && event.data.contextWindow
        if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return state
        if (w === state.contextWindow) return state
        return { ...state, contextWindow: w }
      }

      if (event.type === 'assistant/message') {
        const u = event.data && event.data.usage
        if (!u || typeof u !== 'object') return state
        const p = (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
        if (!(p > 0)) return state
        return { ...state, pressureTokens: p }
      }

      return state
    }
  }
}

/**
 * 读某个会话当前的上下文占用率。
 * @returns {{percent:number,pressureTokens:number,contextWindow:number}|null}
 */
export function readPressure (projections, session) {
  if (!projections || !session) return null
  try {
    const s = projections.stateOf(session, PRESSURE_KEY)
    if (!s || !s.pressureTokens || !s.contextWindow) return null
    return {
      pressureTokens: s.pressureTokens,
      contextWindow: s.contextWindow,
      percent: Math.round((s.pressureTokens / s.contextWindow) * 1000) / 10
    }
  } catch {
    return null
  }
}

/**
 * 敏感度系数：占用超过预警门槛后线性收紧，上限为 1 + maxBoost。
 * 门槛为 0 时不收紧——全程预警本身已覆盖低占用阶段。
 * @param {number|undefined} percent 0-100
 * @param {object} options
 */
export function sensitivityFactor (percent, options) {
  const start = Number(options?.warnAbovePercent) || 0
  const maxBoost = Number(options?.pressureBoostMax) || 0
  if (start <= 0 || maxBoost <= 0) return 1
  if (!Number.isFinite(percent) || percent <= start) return 1
  const t = Math.min(1, (percent - start) / Math.max(1, 100 - start))
  return 1 + t * maxBoost
}

/**
 * 按系数收紧阈值：更容易判定为循环。
 * 间隔类阈值反向放宽（更大间隔也算循环），其余阈值按系数缩小。
 */
export function scaleLimits (options, factor) {
  if (!(factor > 1.001)) return options
  return {
    ...options,
    maxDashRun: Math.max(20, Math.round(options.maxDashRun / factor)),
    maxParenRun: Math.max(4, Math.round(options.maxParenRun / factor)),
    weakDashRun: Math.max(20, Math.round((options.weakDashRun || options.maxDashRun) / factor)),
    weakParenRun: Math.max(4, Math.round((options.weakParenRun || options.maxParenRun) / factor)),
    shortSentenceRepeat: Math.max(3, Math.round(options.shortSentenceRepeat / factor)),
    maxRepeatGap: Math.max(2, Math.round(options.maxRepeatGap * factor)),
    shortRepeatRatio: Math.max(0.01, Number((options.shortRepeatRatio / factor).toFixed(3)))
  }
}
