/**
 * 配置契约的单一来源。所有可调值都能在 cordis.patch.yml 里覆盖，用户的 patch 层随升级保留。
 */

export const VERSION = '1.3.0'

/** 插件在会话事件、注入消息、HTTP 路由里使用的统一前缀。 */
export const PLUGIN_ID = 'dsh-doom-loop-guard'

/** 设置文件（落 ~/.dsh 下），与 patch 默认值合并。 */
export const SETTINGS_FILENAME = `${PLUGIN_ID}.json`

/** 工具名。 */
export const TOOL_NAME = 'doom_loop_report'

/** HTTP 路由前缀。 */
export const ROUTE_PREFIX = `/api/${PLUGIN_ID}`

/** 请求体上限（设置 POST），防止手滑提交大对象。 */
export const MAX_BODY_BYTES = 64 * 1024

/** 注入消息的来源标识。 */
export const NOTICE_SOURCE_KIND = PLUGIN_ID

/** 预设防护等级：用户只选档，不碰具体阈值。standard 为校准值（召回 100%、误报 0）。 */
export const PRESETS = {
  relaxed: { maxDashRun: 1200, maxParenRun: 300, shortSentenceRepeat: 20, maxRepeatGap: 6, shortRepeatRatio: 0.08 },
  standard: { maxDashRun: 800, maxParenRun: 200, shortSentenceRepeat: 15, maxRepeatGap: 8, shortRepeatRatio: 0.05 },
  sensitive: { maxDashRun: 500, maxParenRun: 120, shortSentenceRepeat: 10, maxRepeatGap: 12, shortRepeatRatio: 0.03 }
}

/** 内置提示音（`assets/<name>.wav`）。风格统一为短、快、急、促，全部由 `tools/make_alerts.py` 合成。 */
export const SOUNDSETS = ['pulse', 'triple', 'rise', 'sting', 'ticks', 'alarm']

/** 默认阈值与运行参数。 */
export const DEFAULTS = {
  /** 防护等级：relaxed / standard / sensitive。 */
  preset: 'standard',
  /** 总开关：关闭后不监听流、不注入，但工具与路由仍可用。 */
  enabled: true,
  /** 强信号：连续破折号填充（字符）。真循环样本为上千字符的连续块，格式碎片多在 300-800。 */
  maxDashRun: 800,
  /** 强信号：连续左括号嵌套（字符）。 */
  maxParenRun: 200,
  /** 中信号：破折号碎片下限，只进报告不触发实时提醒。 */
  weakDashRun: 300,
  /** 中信号：括号嵌套下限，只进报告。 */
  weakParenRun: 60,
  /** 中信号：连续同一感叹号/问号的数量下限，只进报告（不响铃、不注入）。 */
  weakPunctRun: 20,
  /** 检测窗口内同一短句至少重复几次。 */
  shortSentenceRepeat: 15,
  /** 同一短句相邻两次出现允许的最大字符距离：卡死循环只有几个字符，列表推进则隔着一整段正文。 */
  maxRepeatGap: 8,
  /** 重复短句占窗口字符的比例下限（防单句误报）。 */
  shortRepeatRatio: 0.05,
  /** 实时检测窗口（字符）。只保留尾部窗口，避免长推理占内存。 */
  windowChars: 4000,
  /** 同一 attempt 内每类形态最多提醒一次。 */
  remindOncePerAttempt: true,
  /** 预警门槛：上下文占用达到该百分比后才开始检测与提醒；0 表示全程预警。同时作为阈值收紧的起点。 */
  warnAbovePercent: 50,
  /** 占用从门槛升到 100% 时的最大收紧比例（0.6 表示阈值最多降到原来的 1/1.6）。 */
  pressureBoostMax: 0.6,
  /** 命中后的处置方式：nudge 注入提醒 / cut 主动截断 / observe 只记录。 */
  intervention: 'nudge',
  /** cut 模式下，回合结束后自动续跑。 */
  autoResume: true,
  /** cut 模式下，连续截断上限，超过则改为注入提醒等用户处理。 */
  maxConsecutiveCuts: 3,
  /** 注入文本里列出被禁用的循环片段。 */
  banList: true,
  /** 命中时播放提示音。 */
  soundEnabled: true,
  /** 命中时弹系统通知（Windows Toast / macOS / Linux）。 */
  notifyEnabled: true,
  /** 两次播放的最小间隔（毫秒），避免连续命中叠音。 */
  soundCooldownMs: 5000,
  /** 内置提示音：SOUNDSETS 之一。默认 rise（急升），短快急促、辨识度最高。 */
  soundset: 'rise',
  /** 自定义音频路径；非空且文件存在时优先于 soundset。 */
  soundPath: '',
  /** 提醒文本。占位符 {kind} {detail}。 */
  reminderText: '【Doom Loop Guard】检测到输出在原地重复：{detail}。请立即停止重复，按顺序做三件事：1）一句话复述当前要解决的问题；2）列出已确认的事实；3）给出下一步单一行动，或向用户提问。不要再展开新的分支。',
  /** 事后扫描：默认只扫最近 N 天。 */
  reportDays: 7,
  /** 事后扫描：最多返回的会话数。 */
  reportLimit: 20
}
