/**
 * 重复循环检测：纯函数，无 IO。
 *
 * 形态来自 1.6 万条真实思维链的校准：
 *   - 符号崩坏：破折号 / 括号被当成占位反复填充，最长一条连续填充 12144 字符
 *   - 低信息循环：短句在窗口内高频重复（"好。执行。"），单次重复 20-76 次
 *
 * 分两档输出：
 *   high  强信号（破折号 ≥800 / 括号 ≥200 / 短句高频+极短间隔）—— 实时预警只认这一档
 *   low   中信号（破折号 300-800 / 括号 60-200）—— 多为格式碎片化而非真循环，只进报告
 *
 * 依据：阴性样本里破折号 300-800 的多为技术描述中的插入语，
 * 而真循环的破折号是 1197-12144 字符的连续填充。
 */

/** 连续破折号填充：`——**——**` 之类，长度按字符计。 */
const DASH_RUN = /(?:——\*{0,2}\s*){3,}/g
/** 连续左括号嵌套：`（（（（`。 */
const PAREN_RUN = /（{4,}/g
/** 句子切分。 */
const SENT_SPLIT = /[。！？!?；;\n]+/
/** 视为“无信息短句”的长度范围。单字中文也计入（"好。执行。" 是典型空转）。 */
const SHORT_MIN = 1
const SHORT_MAX = 10
/** 短句至少要含一个汉字或两个字母，排除 "1." "**" "：" 这类碎片。 */
const WORDLIKE = /[\u4e00-\u9fa5]|[A-Za-z]{2,}/
/** 局部窗口：循环往往只占一段，全文占比会被前后正常内容稀释。 */
const WINDOW_CHARS = 800
const WINDOW_STEP = 400

/**
 * 单个窗口内的重复短句统计。
 * minGap 是同一短句相邻两次出现的最小字符距离：卡死循环时它只有几个字符，
 * 列表推进时每项之间隔着正文，因而明显更大。
 * @param {string} chunk
 */
function ratioOf (chunk) {
  const positions = new Map()
  let cursor = 0
  for (const raw of chunk.split(SENT_SPLIT)) {
    const start = cursor
    cursor += raw.length + 1
    const s = raw.trim()
    if (s.length < SHORT_MIN || s.length > SHORT_MAX) continue
    if (!WORDLIKE.test(s)) continue
    if (!positions.has(s)) positions.set(s, [])
    positions.get(s).push(start)
  }

  let repeated = 0
  let worstCount = 0
  let worstSentence = ''
  let minGap = Infinity
  for (const [s, list] of positions) {
    if (list.length < 3) continue
    repeated += s.length * list.length
    if (list.length > worstCount) {
      worstCount = list.length
      worstSentence = s
    }
    for (let i = 1; i < list.length; i++) {
      const gap = list[i] - list[i - 1]
      if (gap < minGap) minGap = gap
    }
  }
  return {
    repeated,
    worstCount,
    worstSentence,
    minGap: Number.isFinite(minGap) ? minGap : 0,
    ratio: chunk.length ? repeated / chunk.length : 0
  }
}

/**
 * @typedef {object} Findings
 * @property {boolean} collapsed 是否有任何信号（high 或 low）
 * @property {'high'|'low'|null} confidence 信号强度
 * @property {'symbol'|'loop'|null} kind 形态
 * @property {string} detail 触发说明（写入提醒与报告）
 * @property {object} stats 原始指标，供报告与测试使用
 */

/**
 * 测一条自然语言文本的循环指标。
 * @param {string} text 已剥离代码块的文本
 * @returns {Findings}
 */
export function measure (text) {
  const src = typeof text === 'string' ? text : ''
  const stats = {
    chars: src.length,
    maxDashRun: 0,
    maxParenRun: 0,
    worstSentence: '',
    worstCount: 0,
    repeatedShortChars: 0,
    shortRepeatRatio: 0,
    minRepeatGap: 0
  }
  if (!src) return { collapsed: false, confidence: null, kind: null, detail: '', stats }

  for (const m of src.matchAll(DASH_RUN)) {
    if (m[0].length > stats.maxDashRun) stats.maxDashRun = m[0].length
  }
  for (const m of src.matchAll(PAREN_RUN)) {
    if (m[0].length > stats.maxParenRun) stats.maxParenRun = m[0].length
  }

  let best = { ratio: 0, worstCount: 0, worstSentence: '', repeated: 0, minGap: 0 }
  for (let i = 0; i < src.length; i += WINDOW_STEP) {
    const chunk = src.slice(i, i + WINDOW_CHARS)
    const current = ratioOf(chunk)
    const currentScore = current.minGap > 0 && current.minGap <= 20 ? current.worstCount : 0
    const bestScore = best.minGap > 0 && best.minGap <= 20 ? best.worstCount : 0
    if (currentScore > bestScore || (currentScore === bestScore && current.ratio > best.ratio)) best = current
    if (i + WINDOW_CHARS >= src.length) break
  }
  stats.worstSentence = best.worstSentence
  stats.worstCount = best.worstCount
  stats.repeatedShortChars = best.repeated
  stats.shortRepeatRatio = best.ratio
  stats.minRepeatGap = best.minGap

  return { collapsed: false, confidence: null, kind: null, detail: '', stats }
}

/**
 * 按阈值判定。分 high / low 两档，实时预警只认 high。
 * @param {string} text 已剥离代码块的文本
 * @param {object} limits 见 constants.js DEFAULTS
 * @returns {Findings}
 */
export function detect (text, limits) {
  const findings = measure(text)
  const { stats } = findings
  const dashHigh = Number(limits?.maxDashRun) || 0
  const parenHigh = Number(limits?.maxParenRun) || 0
  const dashLow = Number(limits?.weakDashRun) || 0
  const parenLow = Number(limits?.weakParenRun) || 0
  const minCount = Number(limits?.shortSentenceRepeat) || 0
  const maxGap = Number(limits?.maxRepeatGap) || 0
  const ratio = Number(limits?.shortRepeatRatio) || 0

  // 强信号：极端符号填充
  if (dashHigh > 0 && stats.maxDashRun >= dashHigh) {
    return {
      ...findings,
      collapsed: true,
      confidence: 'high',
      kind: 'symbol',
      detail: `连续破折号填充 ${stats.maxDashRun} 字符（阈值 ${dashHigh}）`
    }
  }
  if (parenHigh > 0 && stats.maxParenRun >= parenHigh) {
    return {
      ...findings,
      collapsed: true,
      confidence: 'high',
      kind: 'symbol',
      detail: `连续括号嵌套 ${stats.maxParenRun} 字符（阈值 ${parenHigh}）`
    }
  }
  // 强信号：短句高频 + 极短间隔 + 足够占比
  if (maxGap > 0 && minCount > 0 &&
    stats.worstCount >= minCount &&
    stats.minRepeatGap > 0 && stats.minRepeatGap <= maxGap &&
    stats.shortRepeatRatio >= ratio) {
    return {
      ...findings,
      collapsed: true,
      confidence: 'high',
      kind: 'loop',
      detail: `短句「${stats.worstSentence}」重复 ${stats.worstCount} 次、间隔 ${stats.minRepeatGap} 字符（阈值：${minCount} 次 / ${maxGap} 字符 / 占比 ${(ratio * 100).toFixed(0)}%）`
    }
  }
  // 中信号：符号填充但量级不够，只进报告
  if (dashLow > 0 && stats.maxDashRun >= dashLow) {
    return {
      ...findings,
      collapsed: true,
      confidence: 'low',
      kind: 'symbol',
      detail: `破折号碎片 ${stats.maxDashRun} 字符（疑似格式碎片，未达强阈值 ${dashHigh}）`
    }
  }
  if (parenLow > 0 && stats.maxParenRun >= parenLow) {
    return {
      ...findings,
      collapsed: true,
      confidence: 'low',
      kind: 'symbol',
      detail: `括号嵌套 ${stats.maxParenRun} 字符（疑似，未达强阈值 ${parenHigh}）`
    }
  }
  return findings
}

/**
 * 定位循环起点，供截断与摘录使用。
 * symbol：最长连续填充的起点；loop：同一句连续三次密集出现的起点。
 *
 * from 是搜索起点（原文偏移）：检测在剥离代码后的尾部窗口上做，
 * 定位必须在原文的同一尾部窗口里找，否则同一句在文章开头出现过时会被误剪。
 *
 * @param {string} text 原文（不剥离代码）
 * @param {Findings} finding
 * @param {number} [from] 搜索起点，默认 0
 * @returns {number} 保留 text.slice(0, cut)
 */
export function cutIndex (text, finding, from = 0) {
  const src = typeof text === 'string' ? text : ''
  if (!src) return 0
  const start = Math.max(0, Math.min(Number(from) || 0, src.length))
  const stats = finding && finding.stats ? finding.stats : measure(src).stats
  const sub = src.slice(start)

  if (finding && finding.kind === 'symbol') {
    let best = { len: 0, index: 0 }
    for (const m of sub.matchAll(DASH_RUN)) {
      if (m[0].length > best.len) best = { len: m[0].length, index: m.index }
    }
    for (const m of sub.matchAll(PAREN_RUN)) {
      if (m[0].length > best.len) best = { len: m[0].length, index: m.index }
    }
    if (best.len > 0) return start + best.index
  }

  const sentence = stats.worstSentence
  if (!sentence) return Math.max(start, src.length - 200)
  let pos = sub.indexOf(sentence)
  if (pos < 0) return Math.max(start, src.length - 200)
  let runStart = pos
  let prev = pos
  let run = 1
  for (;;) {
    const next = sub.indexOf(sentence, prev + sentence.length)
    if (next < 0) break
    if (next - prev <= 30) {
      run++
      if (run >= 3) return start + runStart
    } else {
      run = 1
      runStart = next
    }
    prev = next
  }
  return start + runStart
}

/**
 * 剥离代码块与行内代码：代码缩进和括号会污染重复度，必须先剔除。
 * 未闭合的围栏（流式输出中途、被截断）从围栏处截到末尾——否则后续正文会被当成代码或反之。
 * @param {string} text
 * @returns {string}
 */
export function stripCode (text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/```[\s\S]*$/g, '\n')
    .replace(/`[^`\n]{1,80}`/g, ' ')
}
