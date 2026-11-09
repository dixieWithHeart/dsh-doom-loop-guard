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
        state = { ...state, loading: false, error: (e && e.message) || '无法连接宿主路由' }
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
        state = { ...state, scanning: false, scanError: (e && e.message) || '扫描失败' }
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
        h('span', { style: S.label }, label + '：' + value + (suffix || '')),
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
      if (!report) return h('div', { style: S.empty }, '还没有扫描结果')
      if (!report.sessions || report.sessions.length === 0) {
        return h('div', { style: S.empty }, '已扫描 ' + report.scanned + ' 个会话，没有发现循环')
      }
      const projectOf = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || ''
      return h('div', { style: S.list },
        report.sessions.map((s, i) => h('div', { key: s.id + i, style: S.item },
          h('div', { style: S.itemHead },
            h('span', { style: S.itemTitle }, s.title || projectOf(s.cwd) || s.id),
            h('span', { style: S.badge }, 'doom ' + (s.doom === undefined ? '—' : s.doom)),
            h('span', { style: S.badge }, s.collapsedCount + '/' + s.reasoningCount + ' 块')
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
          setMsg({ text: text || '已保存', bad: false })
        } catch (e) {
          setMsg({ text: (e && e.message) || '保存失败', bad: true })
        }
      }, [])

      const testSound = useCallback(async () => {
        try {
          const r = await fetch(API + '/sound', { method: 'POST' })
          const j = await r.json()
          setMsg({ text: j.played ? '已播放' : '播放失败', bad: !j.played })
        } catch {
          setMsg({ text: '试听失败', bad: true })
        }
      }, [])

      const presetLabel = { relaxed: '宽松', standard: '普通', sensitive: '敏感' }
      const interventionLabel = { observe: '只记录', nudge: '提醒', cut: '截断' }

      return h('div', { style: S.card },
        h('div', { style: S.head },
          h('h3', { style: S.title }, '推理死循环防护'),
          h('span', { style: S.badge }, 'v' + (snap.version || '—')),
          h('span', { style: S.status },
            snap.loading ? '连接中…' : snap.error ? '不可用' : (s.enabled ? '运行中' : '已暂停'))
        ),
        h('p', { style: S.desc }, '检测推理中的重复循环，命中时提醒、截断或响铃。'),

        h('div', { style: S.field },
          h('span', { style: S.rowTitle }, '防护等级'),
          h(Segmented, {
            value: s.preset || 'standard',
            options: [
              { value: 'relaxed', label: '宽松' },
              { value: 'standard', label: '普通' },
              { value: 'sensitive', label: '敏感' }
            ],
            onChange: (v) => apply({ preset: v }, '防护等级：' + presetLabel[v])
          }),
          h('span', { style: S.hint }, '宽松少打扰，敏感更早介入')
        ),

        h('div', { style: S.field },
          h('span', { style: S.rowTitle }, '命中处理'),
          h(Segmented, {
            value: s.intervention || 'nudge',
            options: [
              { value: 'observe', label: '只记录' },
              { value: 'nudge', label: '提醒' },
              { value: 'cut', label: '截断' }
            ],
            onChange: (v) => apply({ intervention: v }, '命中处理：' + interventionLabel[v])
          }),
          h('span', { style: S.hint }, '提醒会注入提示词禁用循环字符,截断会中止当前输出'),
          h('span', { style: S.hint }, '（截断模式，如果有自动续跑等插件，可能会导致无限循环）')
        ),

        h(Slider, {
          label: '生效门槛',
          value: s.warnAbovePercent || 0,
          min: 0,
          max: 100,
          step: 5,
          suffix: '%',
          onChange: (v) => apply({ warnAbovePercent: v }, v === 0 ? '全程生效' : v + '% 后生效')
        }),

        h('div', { style: S.row },
          h('div', { style: S.rowText },
            h('div', { style: S.rowTitle }, '提示音'),
            h('div', { style: S.hint }, '命中时播放')
          ),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('button', { type: 'button', style: S.link, onClick: testSound }, '试听'),
            h(Toggle, {
              on: s.soundEnabled !== false,
              label: '提示音',
              onChange: (v) => apply({ soundEnabled: v }, v ? '已开启' : '已关闭')
            })
          )
        ),

        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('div', { style: S.rowText },
              h('div', { style: S.rowTitle }, '历史报告'),
              h('div', { style: S.hint },
                snap.report ? '已扫描 ' + snap.report.scanned + ' 个会话' : '未扫描')
            ),
            h('button', {
              type: 'button',
              style: S.link,
              disabled: snap.scanning,
              onClick: () => refreshReport()
            }, snap.scanning ? '扫描中…' : '扫描')
          ),
          snap.scanError ? h('div', { style: S.msg(true) }, snap.scanError) : null,
          h('div', { style: S.stats },
            h(Stat, { k: '命中会话', v: snap.report ? String(snap.report.totalCollapsedSessions || 0) : '—' }),
            h(Stat, { k: '命中条数', v: snap.report ? String(snap.report.totalHits || 0) : '—' }),
            h(Stat, { k: '最高 doom', v: snap.report ? String(snap.report.maxDoom || 0) : '—' })
          ),
          h(ReportList, { report: snap.report })
        ),

        snap.lastEvent
          ? h('div', { style: S.hint },
            '最近命中：' + new Date(snap.lastEvent.at).toLocaleTimeString() + ' · '
            + (snap.lastEvent.kind === 'symbol' ? '符号填充' : '短句循环') + ' · 注入 '
            + ({ ok: '成功', 'no-agent': '未找到 agent', error: '失败', none: '未触发' }[snap.lastEvent.inject] || '—'))
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

    const inject = ['slots']

    function apply (ctx) {
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
          { name: 'settings.section', id: 'doom-loop-guard', order: 245, label: '推理死循环防护' },
          SettingsPage,
          'settings.section'
        ),
        'doom-loop-settings-section'
      )
    }

    return { inject, apply }
  }
})
