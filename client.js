// dsh-doom-loop-guard — 浏览器半 / browser half
//
// 注册一个设置页（settings.section）：实时预警开关、阈值调参、历史报告。
// 契约：
//   · window.__ModuleLoader__.load({ id, factory }) —— id 必须等于包名
//   · factory 里的 require 只认白名单模块（react），不能 import 项目内相对路径
//   · 不 require 任何 @deepseek-ai/dsh-client-* 包
//   · 样式只用 --dsw-alias-* 主题 token，且都带 fallback
//
// 分区：常量 / store / 样式 / 小组件 / 页面 / 注册。修改时按锚点定位。

window.__ModuleLoader__.load({
  id: 'dsh-doom-loop-guard',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    // ═══ 1. 常量 ═══════════════════════════════════════════════════════
    const API = '/api/dsh-doom-loop-guard'
    const POLL_MS = 5000
    const LOG = '[dsh-doom-loop-guard]'

    // 界面文案：走宿主 locale 服务（ctx.locale），随界面语言切换即时更新。
    // locale/*.json 只放插件清单的 meta，不承载界面文案——界面字典必须内联在 client 里。
    const NS = 'doomLoopGuard'
    const DICTS = {
      zh: {
        nav: '推理死循环防护',
        title: '推理死循环防护',
        desc: '检测推理中的重复循环，命中时提醒、截断或响铃。',
        'status.connecting': '连接中…',
        'status.unavailable': '不可用',
        'status.running': '运行中',
        'status.paused': '已暂停',
        level: '防护等级',
        'level.relaxed': '宽松',
        'level.standard': '普通',
        'level.sensitive': '敏感',
        'level.hint': '宽松少打扰，敏感更早介入',
        'level.saved': '防护等级：{value}',
        action: '命中处理',
        'action.observe': '只记录',
        'action.nudge': '提醒',
        'action.cut': '截断',
        'action.hint': '提醒会注入提示词禁用循环字符,截断会中止当前输出',
        'action.warn': '（截断模式，如果有自动续跑等插件，可能会导致无限循环）',
        'action.saved': '命中处理：{value}',
        threshold: '生效门槛',
        'threshold.always': '全程生效',
        'threshold.after': '{percent}% 后生效',
        sound: '提示音',
        'sound.hint': '命中时播放',
        'sound.on': '已开启',
        'sound.off': '已关闭',
        'sound.played': '已播放',
        'sound.failed': '播放失败',
        'sound.testFailed': '试听失败',
        soundset: '音色',
        'soundset.pulse': '双脉冲',
        'soundset.triple': '三连',
        'soundset.rise': '急升',
        'soundset.sting': '刺音',
        'soundset.ticks': '滴答',
        'soundset.alarm': '交替',
        'soundset.saved': '音色：{value}',
        notify: '系统通知',
        'notify.hint': '命中时弹一条桌面通知',
        'notify.on': '通知已开启',
        'notify.off': '通知已关闭',
        report: '历史报告',
        'report.scanned': '已扫描 {count} 个会话',
        'report.notScanned': '未扫描',
        'report.scanning': '扫描中…',
        'report.scan': '扫描',
        'report.empty': '还没有扫描结果',
        'report.clean': '已扫描 {count} 个会话，没有发现循环',
        'report.blocks': '{collapsed}/{reasoning} 块',
        'stat.sessions': '命中会话',
        'stat.hits': '命中条数',
        'stat.maxDoom': '最高 doom',
        lastHit: '最近命中：{time} · {kind} · 注入 {inject}',
        'kind.symbol': '符号填充',
        'kind.phrase': '短句循环',
        'inject.ok': '成功',
        'inject.noAgent': '未找到 agent',
        'inject.error': '失败',
        'inject.none': '未触发',
        saved: '已保存',
        saveFailed: '保存失败',
        'err.host': '无法连接宿主路由',
        'err.scan': '扫描失败',
        sep: '：'
      },
      en: {
        nav: 'Doom Loop Guard',
        title: 'Doom Loop Guard',
        desc: 'Detects repetitive loops in reasoning and nudges, cuts, or chimes on a hit.',
        'status.connecting': 'Connecting…',
        'status.unavailable': 'Unavailable',
        'status.running': 'Running',
        'status.paused': 'Paused',
        level: 'Protection level',
        'level.relaxed': 'Relaxed',
        'level.standard': 'Standard',
        'level.sensitive': 'Sensitive',
        'level.hint': 'Relaxed interrupts less; sensitive steps in earlier',
        'level.saved': 'Protection level: {value}',
        action: 'On a hit',
        'action.observe': 'Record only',
        'action.nudge': 'Nudge',
        'action.cut': 'Cut',
        'action.hint': 'A nudge injects a prompt that bans loop characters; cut aborts the current output',
        'action.warn': '(In cut mode, an auto-continue plugin may keep the loop going indefinitely)',
        'action.saved': 'On a hit: {value}',
        threshold: 'Activation threshold',
        'threshold.always': 'Always active',
        'threshold.after': 'Active above {percent}%',
        sound: 'Chime',
        'sound.hint': 'Plays on a hit',
        'sound.on': 'On',
        'sound.off': 'Off',
        'sound.played': 'Played',
        'sound.failed': 'Playback failed',
        'sound.testFailed': 'Preview failed',
        soundset: 'Sound',
        'soundset.pulse': 'Pulse',
        'soundset.triple': 'Triple',
        'soundset.rise': 'Rise',
        'soundset.sting': 'Sting',
        'soundset.ticks': 'Ticks',
        'soundset.alarm': 'Alarm',
        'soundset.saved': 'Sound: {value}',
        notify: 'Desktop notification',
        'notify.hint': 'Shows a desktop notification on a hit',
        'notify.on': 'Notifications on',
        'notify.off': 'Notifications off',
        report: 'History report',
        'report.scanned': 'Scanned {count} sessions',
        'report.notScanned': 'Not scanned',
        'report.scanning': 'Scanning…',
        'report.scan': 'Scan',
        'report.empty': 'No scan results yet',
        'report.clean': 'Scanned {count} sessions; no loops found',
        'report.blocks': '{collapsed}/{reasoning} blocks',
        'stat.sessions': 'Sessions hit',
        'stat.hits': 'Hits',
        'stat.maxDoom': 'Peak doom',
        lastHit: 'Last hit: {time} · {kind} · injected {inject}',
        'kind.symbol': 'Symbol padding',
        'kind.phrase': 'Phrase repeat',
        'inject.ok': 'ok',
        'inject.noAgent': 'no agent',
        'inject.error': 'failed',
        'inject.none': 'not fired',
        saved: 'Saved',
        saveFailed: 'Save failed',
        'err.host': 'Cannot reach the host route',
        'err.scan': 'Scan failed',
        sep: ': '
      }
    }

    /** lastEvent.inject 取值 → 字典键（未知值仍渲染破折号，保持原行为）。 */
    const INJECT_KEY = { ok: 'inject.ok', 'no-agent': 'inject.noAgent', error: 'inject.error', none: 'inject.none' }

    /** 内置音色（与宿主 src/constants.js 的 SOUNDSETS 保持一致）。 */
    const SOUNDSETS = ['pulse', 'triple', 'rise', 'sting', 'ticks', 'alarm']

    /** 占位符替换，语义与宿主 locale 的 translate 一致（`{name}` → params.name）。 */
    function fill (template, params) {      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
    }

    // apply 前只有兜底值（内置中文）；宿主 locale 可用时替换为 bind(NS)。
    let t = (key, params) => fill(DICTS.zh[key] === undefined ? key : DICTS.zh[key], params)

    const DEFAULTS = {
      enabled: true,
      maxDashRun: 800,
      maxParenRun: 200,
      weakDashRun: 300,
      weakParenRun: 60,
      shortSentenceRepeat: 15,
      maxRepeatGap: 8,
      shortRepeatRatio: 0.05,
      windowChars: 4000,
      warnAbovePercent: 50,
      pressureBoostMax: 0.6,
      intervention: 'nudge',
      autoResume: true,
      maxConsecutiveCuts: 3,
      banList: true,
      soundEnabled: true,
      notifyEnabled: true,
      soundset: 'rise',
      soundCooldownMs: 5000,
      soundPath: '',
      reportDays: 7,
      reportLimit: 20
    }

    // ═══ 2. store：轮询与写入 ══════════════════════════════════════════
    let state = {
      loading: true,
      error: null,
      version: '',
      settings: { ...DEFAULTS },
      report: null,
      lastEvent: null,
      scanning: false,
      scanError: null
    }
    const listeners = new Set()
    const emit = () => { for (const fn of listeners) fn(state) }

    async function refreshState () {
      try {
        const r = await fetch(API + '/state', { headers: { accept: 'application/json' } })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = await r.json()
        state = {
          ...state,
          loading: false,
          error: null,
          version: j.version || '',
          settings: { ...DEFAULTS, ...(j.settings || {}) },
          lastEvent: j.lastEvent || null
        }
      } catch (e) {
        state = { ...state, loading: false, error: (e && e.message) || t('err.host') }
      }
      emit()
    }

    async function refreshReport () {
      state = { ...state, scanning: true, scanError: null }
      emit()
      try {
        const days = state.settings.reportDays || 7
        const r = await fetch(API + '/report?days=' + encodeURIComponent(days) + '&limit=20', { headers: { accept: 'application/json' } })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = await r.json()
        state = { ...state, scanning: false, report: j, scanError: null }
      } catch (e) {
        state = { ...state, scanning: false, scanError: (e && e.message) || t('err.scan') }
      }
      emit()
    }

    async function save (patch) {
      const r = await fetch(API + '/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      })
      let j = null
      try { j = await r.json() } catch { /* 非 JSON 按失败处理 */ }
      if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + r.status))
      state = { ...state, settings: { ...DEFAULTS, ...(j.settings || {}) }, error: null }
      emit()
      return j
    }

    function useStore () {
      const [snap, setSnap] = useState(state)
      useEffect(() => {
        listeners.add(setSnap)
        setSnap(state)
        return () => { listeners.delete(setSnap) }
      }, [])
      return snap
    }

    // ═══ 3. 样式（只用主题 token，全部带 fallback）══════════════════════
    // @ui-kit v1.3.0  共享 UI 基座（源：plugins/_shared/ui-kit.js；改源后重新复制本段）
    // ═════════════════════════════ [C] 颜色 token ═════════════════════════
    const C = {
      border: 'var(--dsw-alias-border-subtle, rgba(130,130,140,0.28))',
      text: 'var(--dsw-alias-text-primary, inherit)',
      dim: 'var(--dsw-alias-text-secondary, rgba(140,140,150,1))',
      accent: 'var(--dsw-alias-accent, #4f7cff)',
      surface: 'var(--dsw-alias-surface-raised, rgba(130,130,140,0.06))',
      ok: 'var(--dsw-alias-success, #2f9e6b)',
      warn: 'var(--dsw-alias-warning, #c8862a)',
      danger: 'var(--dsw-alias-danger, #e5534b)',
      radius: 'var(--dsw-radius-lg, 12px)',
      radiusSm: 'var(--dsw-radius-sm, 8px)',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }

    // ═════════════════════════ [S_BASE] 通用样式 ═════════════════════════
    // 插件用 `{ ...S_BASE, ...特有键 }` 组装自己的 S，特有键不要回填本文件。
    const S_BASE = {
      card: { border: '1px solid ' + C.border, borderRadius: C.radius, padding: '16px 18px', display: 'grid', gap: '14px', color: C.text },
      head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      badge: { fontSize: '12px', color: C.dim, border: '1px solid ' + C.border, borderRadius: '999px', padding: '1px 8px' },
      status: { marginLeft: 'auto', fontSize: '12px', color: C.dim },
      desc: { margin: 0, fontSize: '13px', lineHeight: 1.6, color: C.dim },
      /* 行布局自适应：空间不够时控件整体换到下一行，而不是把标题挤成一字一列 */
      row: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' },
      rowText: { display: 'grid', gap: '2px', flex: '1 1 200px', minWidth: '180px' },
      rowTitle: { fontSize: '13px', fontWeight: 550 },
      rowDesc: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      field: { display: 'grid', gap: '4px' },
      label: { fontSize: '12px', color: C.dim },
      hint: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      inline: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 1 auto', flexWrap: 'wrap', justifyContent: 'flex-end' },
      toggle: (on) => ({
        width: '38px', height: '22px', borderRadius: '999px', border: '1px solid ' + C.border,
        background: on ? C.accent : 'rgba(130,130,140,0.25)', position: 'relative', cursor: 'pointer',
        flex: 'none', marginTop: '2px', transition: 'background 160ms ease',
      }),
      knob: (on) => ({
        position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px',
        borderRadius: '50%', background: '#fff', transition: 'left 160ms ease',
      }),
      chip: (on) => ({
        padding: '3px 10px', fontSize: '12px', borderRadius: '999px', cursor: 'pointer',
        border: '1px solid ' + (on ? C.accent : C.border),
        background: on ? C.accent : 'transparent',
        color: on ? '#fff' : C.dim,
      }),
      chips: { display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 0 },
      panel: { background: C.surface, borderRadius: C.radiusSm, padding: '12px 14px', display: 'grid', gap: '10px' },
      input: {
        width: '110px', padding: '5px 8px', fontSize: '13px', textAlign: 'right',
        border: '1px solid ' + C.border, borderRadius: C.radiusSm, background: 'transparent', color: C.text,
      },
      textarea: {
        fontFamily: C.mono, fontSize: '12.5px', lineHeight: 1.6, padding: '8px 10px',
        resize: 'vertical', border: '1px solid ' + C.border, borderRadius: '6px',
        background: 'transparent', color: C.text, minHeight: '56px', width: '100%', boxSizing: 'border-box',
      },
      /* 文本输入：与 textarea 同族的全宽、等宽、左对齐；行内需要伸缩时在使用处加 flex */
      textInput: {
        width: '100%', boxSizing: 'border-box',
        fontFamily: C.mono, fontSize: '12.5px', lineHeight: 1.6, padding: '7px 9px',
        border: '1px solid ' + C.border, borderRadius: '6px',
        background: 'transparent', color: C.text,
      },
      btn: (disabled) => ({
        padding: '5px 12px', fontSize: '13px', borderRadius: C.radiusSm,
        border: '1px solid ' + C.border, background: 'transparent', color: C.text,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, flex: 'none',
      }),
      link: { fontSize: '13px', padding: '5px 12px', borderRadius: C.radiusSm, border: '1px solid ' + C.border, background: 'transparent', color: C.text, cursor: 'pointer' },
      line: {
        fontFamily: C.mono, fontSize: '12.5px', lineHeight: 1.6, wordBreak: 'break-all',
        background: 'rgba(130,130,140,0.12)', borderRadius: '6px', padding: '8px 10px', color: C.text,
      },
      empty: { fontSize: '12.5px', color: C.dim, fontStyle: 'italic' },
      msg: (bad) => ({ fontSize: '12px', color: bad ? C.danger : C.dim }),
      foot: { fontSize: '12px', color: C.dim, lineHeight: 1.6, margin: 0 },
      mono: { fontFamily: C.mono, wordBreak: 'break-all' },
      statItem: { display: 'grid', gap: '2px' },
      statValue: { fontSize: '18px', fontWeight: 600 },
      statKey: { fontSize: '12px', color: C.dim },
      range: { width: '100%', accentColor: C.accent, cursor: 'pointer' },
      sliderHead: { display: 'flex', alignItems: 'baseline', gap: '8px', justifyContent: 'space-between' },
      sliderValue: { fontSize: '13px', fontWeight: 600, fontFamily: C.mono },
    }

    // ═════════════════════════ [组件] 通用控件 ═════════════════════════
    /** 开关按钮。 */
    function Toggle ({ on, label, onChange }) {
      return h('button', {
        type: 'button',
        'aria-label': label,
        'aria-pressed': on ? 'true' : 'false',
        style: S.toggle(on),
        onClick: () => onChange(!on),
      }, h('span', { style: S.knob(on) }))
    }

    /** 一行设置：左标题与说明，右控件。 */
    function Row ({ title, desc, control }) {
      return h('div', { style: S.row },
        h('div', { style: S.rowText },
          h('div', { style: S.rowTitle }, title),
          desc ? h('div', { style: S.rowDesc }, desc) : null,
        ),
        control,
      )
    }

    /** 一行文本：有值显示内容，无值显示占位说明。 */
    function Line ({ text, placeholder }) {
      return text
        ? h('div', { style: S.line }, text)
        : h('div', { style: S.empty }, placeholder)
    }

    /** 标签 + 值（值默认等宽）。 */
    function Field ({ label, value, mono }) {
      return h('div', { style: S.field },
        h('span', { style: S.label }, label),
        h('span', { style: mono === false ? { fontSize: '12.5px' } : { fontFamily: C.mono, fontSize: '12.5px' } }, value),
      )
    }

    /** 百分比滑条。valueText 传当前值的可读形式（如 "30%"），不传则只显示标签。 */
    function Slider ({ label, value, min, max, step, hint, valueText, disabled, onChange }) {
      return h('div', { style: S.field },
        h('div', { style: S.sliderHead },
          h('span', { style: S.rowTitle }, label),
          valueText ? h('span', { style: S.sliderValue }, valueText) : null,
        ),
        h('input', {
          type: 'range',
          min,
          max,
          step,
          value: Number(value) || 0,
          style: S.range,
          'aria-label': label,
          disabled,
          onChange: (e) => onChange(Number(e.target.value)),
        }),
        hint ? h('span', { style: S.hint }, hint) : null,
      )
    }

    /** 数据卡片：一个数值 + 一句说明。 */
    function Stat ({ value, label }) {
      return h('div', { style: S.statItem },
        h('div', { style: S.statValue }, value),
        h('div', { style: S.statKey }, label),
      )
    }

    /** 互斥选项组（药丸按钮）。options 为 `[[value, label], ...]`。 */
    function ChipGroup ({ value, options, disabled, onChange }) {
      return h('div', { style: S.chips },
        options.map(([key, label]) => h('button', {
          key,
          type: 'button',
          style: S.chip(value === key),
          'aria-pressed': value === key ? 'true' : 'false',
          disabled,
          onClick: () => onChange(key, label),
        }, label))
      )
    }
    // 模板优先：通用键全部来自 S_BASE，这里只放本插件特有的结构样式。
    const S = {
      ...S_BASE,
      list: { display: 'grid', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' },
      item: {
        display: 'grid',
        gap: '4px',
        minWidth: 0,
        border: '1px solid ' + C.border,
        borderRadius: C.radiusSm,
        padding: '10px 12px'
      },
      itemHead: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' },
      itemTitle: { fontSize: '13px', fontWeight: 500, fontFamily: C.mono, wordBreak: 'break-all', minWidth: 0 },
      itemMeta: { fontSize: '12px', color: C.dim, wordBreak: 'break-all' },
      itemDetail: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      stats: { display: 'flex', gap: '18px', flexWrap: 'wrap' },
    }

    // ═══ 4. 小组件 ═════════════════════════════════════════════════════
    function ReportList ({ report }) {
      if (!report) return h('div', { style: S.empty }, t('report.empty'))
      if (!report.sessions || report.sessions.length === 0) {
        return h('div', { style: S.empty }, t('report.clean', { count: report.scanned }))
      }
      const projectOf = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || ''
      return h('div', { style: S.list },
        report.sessions.map((s, i) => h('div', { key: s.id + i, style: S.item },
          h('div', { style: S.itemHead },
            h('span', { style: S.itemTitle }, s.title || projectOf(s.cwd) || s.id),
            h('span', { style: S.badge }, 'doom ' + (s.doom === undefined ? '—' : s.doom)),
            h('span', { style: S.badge }, t('report.blocks', { collapsed: s.collapsedCount, reasoning: s.reasoningCount }))
          ),
          h('div', { style: S.itemMeta }, projectOf(s.cwd) + ' · ' + (s.cwd || '')),
          s.hits && s.hits[0] ? h('div', { style: S.itemDetail }, s.hits[0].detail) : null
        ))
      )
    }

    // ═══ 5. 页面 ═══════════════════════════════════════════════════════
    function SettingsPage () {
      const snap = useStore()
      const s = snap.settings
      const [msg, setMsg] = useState(null)

      const apply = useCallback(async (patch, text) => {
        setMsg(null)
        try {
          await save(patch)
          setMsg({ text: text || t('saved'), bad: false })
        } catch (e) {
          setMsg({ text: (e && e.message) || t('saveFailed'), bad: true })
        }
      }, [])

      const testSound = useCallback(async (soundset) => {
        try {
          const r = await fetch(API + '/sound', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(soundset ? { soundset } : {})
          })
          const j = await r.json()
          setMsg({ text: j.played ? t('sound.played') : t('sound.failed'), bad: !j.played })
        } catch {
          setMsg({ text: t('sound.testFailed'), bad: true })
        }
      }, [])

      const presetLabel = {
        relaxed: t('level.relaxed'),
        standard: t('level.standard'),
        sensitive: t('level.sensitive')
      }
      const interventionLabel = {
        observe: t('action.observe'),
        nudge: t('action.nudge'),
        cut: t('action.cut')
      }

      return h('div', { style: S.card },
        h('div', { style: S.head },
          h('h3', { style: S.title }, t('title')),
          h('span', { style: S.badge }, 'v' + (snap.version || '—')),
          h('span', { style: S.status },
            snap.loading ? t('status.connecting') : snap.error ? t('status.unavailable') : (s.enabled ? t('status.running') : t('status.paused'))
          )
        ),
        h('p', { style: S.desc }, t('desc')),

        h('div', { style: S.field },
          h('span', { style: S.rowTitle }, t('level')),
          h(ChipGroup, {
            value: s.preset || 'standard',
            options: [
              ['relaxed', presetLabel.relaxed],
              ['standard', presetLabel.standard],
              ['sensitive', presetLabel.sensitive]
            ],
            onChange: (v, label) => apply({ preset: v }, t('level.saved', { value: label }))
          }),
          h('span', { style: S.hint }, t('level.hint'))
        ),

        h('div', { style: S.field },
          h('span', { style: S.rowTitle }, t('action')),
          h(ChipGroup, {
            value: s.intervention || 'nudge',
            options: [
              ['observe', interventionLabel.observe],
              ['nudge', interventionLabel.nudge],
              ['cut', interventionLabel.cut]
            ],
            onChange: (v, label) => apply({ intervention: v }, t('action.saved', { value: label }))
          }),
          h('span', { style: S.hint }, t('action.hint')),
          h('span', { style: S.hint }, t('action.warn'))
        ),

        h(Slider, {
          label: t('threshold'),
          value: s.warnAbovePercent || 0,
          valueText: (s.warnAbovePercent || 0) + '%',
          min: 0,
          max: 100,
          step: 5,
          onChange: (v) => apply({ warnAbovePercent: v }, v === 0 ? t('threshold.always') : t('threshold.after', { percent: v }))
        }),

        h(Row, {
          title: t('sound'),
          desc: t('sound.hint'),
          control: h(Toggle, {
            on: s.soundEnabled !== false,
            label: t('sound'),
            onChange: (v) => apply({ soundEnabled: v }, v ? t('sound.on') : t('sound.off'))
          })
        }),

        h('div', { style: S.field },
          h('span', { style: S.rowTitle }, t('soundset')),
          h(ChipGroup, {
            value: s.soundset || 'rise',
            options: SOUNDSETS.map((id) => [id, t('soundset.' + id)]),
            onChange: (value, label) => {
              apply({ soundset: value }, t('soundset.saved', { value: label }))
              testSound(value)
            }
          })
        ),

        h(Row, {
          title: t('notify'),
          desc: t('notify.hint'),
          control: h(Toggle, {
            on: s.notifyEnabled !== false,
            label: t('notify'),
            onChange: (v) => apply({ notifyEnabled: v }, v ? t('notify.on') : t('notify.off'))
          })
        }),

        h('div', { style: S.panel },
          h(Row, {
            title: t('report'),
            desc: snap.report ? t('report.scanned', { count: snap.report.scanned }) : t('report.notScanned'),
            control: h('button', {
              type: 'button',
              style: S.link,
              disabled: snap.scanning,
              onClick: () => refreshReport()
            }, snap.scanning ? t('report.scanning') : t('report.scan'))
          }),
          snap.scanError ? h('div', { style: S.msg(true) }, snap.scanError) : null,
          h('div', { style: S.stats },
            h(Stat, { label: t('stat.sessions'), value: snap.report ? String(snap.report.totalCollapsedSessions || 0) : '—' }),
            h(Stat, { label: t('stat.hits'), value: snap.report ? String(snap.report.totalHits || 0) : '—' }),
            h(Stat, { label: t('stat.maxDoom'), value: snap.report ? String(snap.report.maxDoom || 0) : '—' })
          ),
          h(ReportList, { report: snap.report })
        ),

        snap.lastEvent
          ? h('div', { style: S.hint },
            t('lastHit', {
              time: new Date(snap.lastEvent.at).toLocaleTimeString(),
              kind: snap.lastEvent.kind === 'symbol' ? t('kind.symbol') : t('kind.phrase'),
              inject: INJECT_KEY[snap.lastEvent.inject] ? t(INJECT_KEY[snap.lastEvent.inject]) : '—'
            }))
          : null,

        msg ? h('div', { style: S.msg(msg.bad) }, msg.text) : null
      )
    }

    // ═══ 6. 注册 ═══════════════════════════════════════════════════════
    function contribute (ctx, key, options, Component, what) {
      const fail = (e) => console.error(LOG, 'could not register ' + what + ':', e)
      try {
        return ctx.slots.inject(key, () => {
          try {
            return ctx.slots.register(options, Component)
          } catch (e) {
            fail(e)
            return () => {}
          }
        })
      } catch (e) {
        fail(e)
        return () => {}
      }
    }

    const inject = ['slots', 'locale']

    function apply (ctx) {
      // 界面文案接入宿主 locale：注册字典后 t 指向 bind(NS)，切换语言即时生效。
      // 精简组合或测试替身可能没有 locale 服务——判存在后退回内置中文，不让整块 UI 崩掉。
      if (ctx.locale && typeof ctx.locale.register === 'function' && typeof ctx.locale.bind === 'function') {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'doom-loop-dicts')
        t = ctx.locale.bind(NS)
      } else {
        console.warn(LOG, 'locale 服务不可用：界面文案固定中文')
      }

      ctx.effect(() => {
        refreshState()
        const timer = setInterval(() => { if (!document.hidden) refreshState() }, POLL_MS)
        const onVisible = () => { if (!document.hidden) refreshState() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, 'doom-loop-poll')

      ctx.effect(
        () => contribute(
          ctx,
          'settings.section',
          { name: 'settings.section', id: 'doom-loop-guard', order: 245, locale: NS, label: () => t('nav') },
          SettingsPage,
          'settings.section'
        ),
        'doom-loop-settings-section'
      )
    }

    return { inject, apply }
  }
})
