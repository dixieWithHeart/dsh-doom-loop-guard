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
    const { useCallback, useEffect, useRef, useState } = React

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
        'sound.test': '试听',
        'sound.on': '已开启',
        'sound.off': '已关闭',
        'sound.played': '已播放',
        'sound.failed': '播放失败',
        'sound.testFailed': '试听失败',
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
        'sound.test': 'Preview',
        'sound.on': 'On',
        'sound.off': 'Off',
        'sound.played': 'Played',
        'sound.failed': 'Playback failed',
        'sound.testFailed': 'Preview failed',
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
      warnAbovePercent: 0,
      pressureBoostMax: 0.6,
      intervention: 'nudge',
      autoResume: true,
      maxConsecutiveCuts: 3,
      banList: true,
      soundEnabled: true,
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
    const C = {
      border: 'var(--dsw-alias-border-subtle, rgba(130,130,140,0.28))',
      text: 'var(--dsw-alias-text-primary, inherit)',
      dim: 'var(--dsw-alias-text-secondary, rgba(140,140,150,1))',
      accent: 'var(--dsw-alias-accent, #4f7cff)',
      danger: 'var(--dsw-alias-state-danger, #d9534f)',
      surface: 'var(--dsw-alias-surface-raised, rgba(130,130,140,0.06))',
      radius: 'var(--dsw-radius-lg, 12px)',
      radiusSm: 'var(--dsw-radius-sm, 8px)',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }

    const S = {
      card: { border: '1px solid ' + C.border, borderRadius: C.radius, padding: '16px 18px', display: 'grid', gap: '14px', color: C.text },
      head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      badge: { fontSize: '12px', color: C.dim, border: '1px solid ' + C.border, borderRadius: '999px', padding: '1px 8px' },
      status: { marginLeft: 'auto', fontSize: '12px', color: C.dim },
      desc: { margin: 0, fontSize: '13px', lineHeight: 1.6, color: C.dim },
      panel: { background: C.surface, borderRadius: C.radiusSm, padding: '12px 14px', display: 'grid', gap: '10px' },
      label: { fontSize: '12px', color: C.dim, display: 'flex', alignItems: 'center', gap: '6px' },
      input: {
        fontFamily: C.mono,
        fontSize: '12.5px',
        lineHeight: 1.6,
        padding: '7px 9px',
        border: '1px solid ' + C.border,
        borderRadius: '6px',
        background: 'transparent',
        color: C.text,
        width: '100%',
        boxSizing: 'border-box'
      },
      row: { display: 'flex', alignItems: 'flex-start', gap: '14px', justifyContent: 'space-between', flexWrap: 'wrap' },
      rowText: { display: 'grid', gap: '3px', flex: '1 1 220px', minWidth: 180 },
      rowTitle: { fontSize: '13.5px', fontWeight: 500 },
      hint: { fontSize: '12px', color: C.dim, lineHeight: 1.5 },
      foot: { margin: 0, fontSize: '12px', color: C.dim, lineHeight: 1.6 },
      empty: { fontSize: '12.5px', color: C.dim, fontStyle: 'italic' },
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
      trendLine: { display: 'flex', gap: '10px', overflowX: 'auto', whiteSpace: 'nowrap', fontSize: '12px', color: C.dim, paddingBottom: '2px' },
      trendItem: { flex: '0 0 auto', fontFamily: C.mono },
      grid: { display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
      field: { display: 'grid', gap: '4px' },
      btn: (disabled) => ({
        fontSize: '12.5px',
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid ' + C.border,
        background: disabled ? 'transparent' : C.accent,
        color: disabled ? C.dim : '#fff',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1
      }),
      link: {
        fontSize: '12.5px',
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid ' + C.border,
        background: 'transparent',
        color: C.text,
        cursor: 'pointer'
      },
      msg: (bad) => ({ fontSize: '12.5px', color: bad ? C.danger : C.dim }),
      stats: { display: 'flex', gap: '18px', flexWrap: 'wrap' },
      statItem: { display: 'grid', gap: '2px' },
      statValue: { fontSize: '18px', fontWeight: 600 },
      statKey: { fontSize: '12px', color: C.dim }
    }

    // ═══ 4. 小组件 ═════════════════════════════════════════════════════
    function Toggle ({ on, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': label,
        onClick: () => onChange(!on),
        style: {
          width: '44px',
          height: '24px',
          borderRadius: '999px',
          border: '1px solid ' + C.border,
          background: on ? C.accent : 'transparent',
          position: 'relative',
          cursor: 'pointer',
          padding: 0,
          flex: '0 0 auto'
        }
      }, h('span', {
        style: {
          position: 'absolute',
          top: '2px',
          left: on ? '22px' : '2px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: on ? '#fff' : C.dim,
          transition: 'left 120ms ease'
        }
      }))
    }

    function Stat ({ k, v }) {
      return h('div', { style: S.statItem },
        h('div', { style: S.statValue }, v),
        h('div', { style: S.statKey }, k)
      )
    }

    function NumberField ({ label, value, min, max, step, onCommit }) {
      const [draft, setDraft] = useState(String(value))
      const dirty = useRef(false)
      useEffect(() => {
        if (!dirty.current) setDraft(String(value))
      }, [value])
      return h('label', { style: S.field },
        h('span', { style: S.label }, label),
        h('input', {
          type: 'number',
          min,
          max,
          step: step || 1,
          style: S.input,
          value: draft,
          onChange: (e) => { dirty.current = true; setDraft(e.target.value) },
          onBlur: () => {
            const n = Number(draft)
            if (!Number.isFinite(n)) { setDraft(String(value)); dirty.current = false; return }
            dirty.current = false
            onCommit(n)
          }
        })
      )
    }

    function Slider ({ label, value, min, max, step, suffix, onChange }) {
      return h('div', { style: S.field },
        h('span', { style: S.label }, label + t('sep') + value + (suffix || '')),
        h('input', {
          type: 'range',
          min,
          max,
          step: step || 1,
          value: Number(value) || 0,
          'aria-label': label,
          style: { width: '100%', accentColor: C.accent, cursor: 'pointer' },
          onChange: (e) => onChange(Number(e.target.value))
        })
      )
    }

    function Segmented ({ value, options, onChange }) {
      return h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        options.map((opt) => h('button', {
          key: opt.value,
          type: 'button',
          onClick: () => onChange(opt.value),
          style: {
            fontSize: '12.5px',
            padding: '5px 12px',
            borderRadius: '6px',
            border: '1px solid ' + C.border,
            background: value === opt.value ? C.accent : 'transparent',
            color: value === opt.value ? '#fff' : C.text,
            cursor: 'pointer'
          }
        }, opt.label))
      )
    }

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

      const testSound = useCallback(async () => {
        try {
          const r = await fetch(API + '/sound', { method: 'POST' })
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
          h(Segmented, {
            value: s.preset || 'standard',
            options: [
              { value: 'relaxed', label: presetLabel.relaxed },
              { value: 'standard', label: presetLabel.standard },
              { value: 'sensitive', label: presetLabel.sensitive }
            ],
            onChange: (v) => apply({ preset: v }, t('level.saved', { value: presetLabel[v] }))
          }),
          h('span', { style: S.hint }, t('level.hint'))
        ),

        h('div', { style: S.field },
          h('span', { style: S.rowTitle }, t('action')),
          h(Segmented, {
            value: s.intervention || 'nudge',
            options: [
              { value: 'observe', label: interventionLabel.observe },
              { value: 'nudge', label: interventionLabel.nudge },
              { value: 'cut', label: interventionLabel.cut }
            ],
            onChange: (v) => apply({ intervention: v }, t('action.saved', { value: interventionLabel[v] }))
          }),
          h('span', { style: S.hint }, t('action.hint')),
          h('span', { style: S.hint }, t('action.warn'))
        ),

        h(Slider, {
          label: t('threshold'),
          value: s.warnAbovePercent || 0,
          min: 0,
          max: 100,
          step: 5,
          suffix: '%',
          onChange: (v) => apply({ warnAbovePercent: v }, v === 0 ? t('threshold.always') : t('threshold.after', { percent: v }))
        }),

        h('div', { style: S.row },
          h('div', { style: S.rowText },
            h('div', { style: S.rowTitle }, t('sound')),
            h('div', { style: S.hint }, t('sound.hint'))
          ),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('button', { type: 'button', style: S.link, onClick: testSound }, t('sound.test')),
            h(Toggle, {
              on: s.soundEnabled !== false,
              label: t('sound'),
              onChange: (v) => apply({ soundEnabled: v }, v ? t('sound.on') : t('sound.off'))
            })
          )
        ),

        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('div', { style: S.rowText },
              h('div', { style: S.rowTitle }, t('report')),
              h('div', { style: S.hint },
                snap.report ? t('report.scanned', { count: snap.report.scanned }) : t('report.notScanned'))
            ),
            h('button', {
              type: 'button',
              style: S.link,
              disabled: snap.scanning,
              onClick: () => refreshReport()
            }, snap.scanning ? t('report.scanning') : t('report.scan'))
          ),
          snap.scanError ? h('div', { style: S.msg(true) }, snap.scanError) : null,
          h('div', { style: S.stats },
            h(Stat, { k: t('stat.sessions'), v: snap.report ? String(snap.report.totalCollapsedSessions || 0) : '—' }),
            h(Stat, { k: t('stat.hits'), v: snap.report ? String(snap.report.totalHits || 0) : '—' }),
            h(Stat, { k: t('stat.maxDoom'), v: snap.report ? String(snap.report.maxDoom || 0) : '—' })
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
