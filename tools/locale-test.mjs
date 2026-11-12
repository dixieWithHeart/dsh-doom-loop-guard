// 双语契约测试：字典中英齐全、界面文案随宿主 locale 切换、缺 locale 服务时退回中文。
// 用法：node plugins/dsh-doom-loop-guard/tools/locale-test.mjs [client.js 路径]
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const FILE = process.argv[2] || new URL('../client.js', import.meta.url).pathname.replace(/^\//, '')

const STATE = {
  version: '9.9.9',
  settings: { enabled: true, preset: 'standard', intervention: 'nudge', warnAbovePercent: 0, soundEnabled: true, reportDays: 7 },
  lastEvent: { at: '2026-11-09T05:00:00.000Z', kind: 'symbol', inject: 'ok' }
}

const REPORT = {
  ok: true,
  scanned: 653,
  totalCollapsedSessions: 2,
  totalHits: 33,
  maxDoom: 88,
  sessions: [{ id: 's1', cwd: 'D:\\demo', doom: 88, collapsedCount: 33, reasoningCount: 258, hits: [] }]
}

let loaded = null
function makeReact () {
  return {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (fn) => { if (typeof fn === 'function') fn() },
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn()
  }
}

globalThis.window = { __ModuleLoader__: { load: (m) => { loaded = m } }, setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0 } }
globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/report') ? REPORT : STATE) })
globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
function check (name, fn) {
  try {
    fn()
    passed++
    console.log(`ok  ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

/** 递归收集渲染树里的文本（函数组件就地执行；深度设上限防自引用）。 */
function texts (node, out = [], depth = 0) {
  if (node === null || node === undefined || depth > 30) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const c of node) texts(c, out, depth + 1); return out }
  if (typeof node.type === 'function') { texts(node.type(node.props || {}), out, depth + 1); return out }
  if (node.children) { for (const c of node.children) texts(c, out, depth + 1) }
  return out
}

/** 在渲染树里找文字匹配、且带 onClick 的按钮（用于触发"扫描"）。 */
function findButton (node, labelText, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30) return null
  if (Array.isArray(node)) {
    for (const c of node) { const hit = findButton(c, labelText, depth + 1); if (hit) return hit }
    return null
  }
  if (typeof node.type === 'function') return findButton(node.type(node.props || {}), labelText, depth + 1)
  if (node.type === 'button' && node.props && typeof node.props.onClick === 'function') {
    if (texts(node).includes(labelText)) return node
  }
  if (node.children) {
    for (const c of node.children) { const hit = findButton(c, labelText, depth + 1); if (hit) return hit }
  }
  return null
}

/** 假 locale 服务：语义对齐宿主 translate（当前语言 → en → 键名，{name} 插值）。 */
function makeLocale () {
  const registry = new Map()
  let active = 'zh'
  let revision = 0
  return {
    get active () { return active },
    registry,
    register (ns, dicts) {
      assert.equal(typeof dicts, 'object', 'register 第二参必须是字典对象')
      registry.set(ns, dicts)
      return () => registry.delete(ns)
    },
    bind (ns) {
      return (key, params) => {
        const dicts = registry.get(ns) || {}
        const dict = dicts[active] || dicts.en || {}
        let tpl = dict[key] === undefined ? key : dict[key]
        if (params) tpl = tpl.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m))
        return tpl
      }
    },
    getSnapshot: () => ({ active, revision }),
    subscribe: (cb) => { void cb; return () => {} },
    setLocale (next) { active = next; revision += 1 }
  }
}

await import(pathToFileURL(FILE).href)
const factory = loaded.factory
check('模块 id 等于包名', () => assert.equal(loaded.id, 'dsh-doom-loop-guard'))
const plugin = factory((name) => {
  if (name === 'react') return makeReact()
  throw new Error('未预期的 require: ' + name)
})

function makeCtx (locale) {
  const registrations = []
  const ctx = {
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    slots: {
      inject: (key, cb) => { cb(); return () => {} },
      register: (options, Component) => { registrations.push({ options, Component }); return () => {} }
    }
  }
  if (locale) ctx.locale = locale
  return { ctx, registrations }
}

// ---- 阶段 A：宿主没有 locale 服务（精简组合 / 测试替身）--------------------------------
{
  const { ctx, registrations } = makeCtx(null)
  let error = null
  try { plugin.apply(ctx) } catch (e) { error = e }
  check('无 locale 服务时 apply 不抛错', () => assert.equal(error, null))
  await sleep(10)
  const section = registrations.find((r) => r.options.name === 'settings.section')
  check('无 locale 服务时仍注册设置页', () => assert.ok(section))
  check('无 locale 服务时导航名退回中文', () => assert.equal(section.options.label(), '推理死循环防护'))
  const flat = texts(section.Component({}))
  check('无 locale 服务时界面文案为中文', () => assert.ok(flat.includes('防护等级')))
}

// ---- 阶段 B：接入宿主 locale -----------------------------------------------------------
{
  const locale = makeLocale()
  const { ctx, registrations } = makeCtx(locale)
  plugin.apply(ctx)
  await sleep(10)

  const ns = [...locale.registry.keys()][0]
  check('向宿主注册了字典命名空间', () => assert.equal(typeof ns, 'string'))
  const dicts = locale.registry.get(ns)
  check('字典同时提供 zh 与 en', () => {
    assert.ok(dicts.zh, '缺 zh')
    assert.ok(dicts.en, '缺 en')
  })
  check('zh / en 键集合完全一致', () => {
    const zh = Object.keys(dicts.zh).sort()
    const en = Object.keys(dicts.en).sort()
    assert.deepEqual(en, zh)
  })
  check('每条译文都非空', () => {
    for (const lang of ['zh', 'en']) {
      for (const [k, v] of Object.entries(dicts[lang])) {
        assert.equal(typeof v, 'string', `${lang}.${k} 不是字符串`)
        assert.ok(v.trim().length > 0, `${lang}.${k} 为空`)
      }
    }
  })
  check('en 字典不是中文照抄', () => {
    const han = /[\u4e00-\u9fff]/
    const copied = Object.entries(dicts.en).filter(([, v]) => han.test(v)).map(([k]) => k)
    assert.deepEqual(copied, [], '这些键的英文值仍是中文：' + copied.join(', '))
  })

  const section = registrations.find((r) => r.options.name === 'settings.section')
  check('注册项声明了 locale 命名空间', () => assert.equal(section.options.locale, ns))
  check('导航名是函数（切换到新语言时重算）', () => assert.equal(typeof section.options.label, 'function'))

  const zhTexts = texts(section.Component({}))
  check('中文界面：导航与正文为中文', () => {
    assert.equal(section.options.label(), '推理死循环防护')
    assert.ok(zhTexts.includes('防护等级'))
    assert.ok(zhTexts.includes('历史报告'))
  })
  check('中文界面：显示六个音色', () => {
    for (const name of ['双脉冲', '三连', '急升', '刺音', '滴答', '交替']) {
      assert.ok(zhTexts.includes(name), name)
    }
  })
  // 报告区只有在扫描之后才有数据，顺带覆盖扫描按钮
  const scanButton = findButton(section.Component({}), '扫描')
  check('中文界面：找到扫描按钮', () => assert.ok(scanButton))
  scanButton.props.onClick()
  await sleep(10)
  const zhReportTexts = texts(section.Component({}))
  check('中文界面：数字插值生效', () => {
    const joined = zhReportTexts.join(' | ')
    assert.ok(joined.includes('已扫描 653 个会话'), '实际：' + joined)
    // 组件化后标签与数值是两个节点（基座 Slider 的 label + valueText），不再拼成「标签：值」
    assert.ok(joined.includes('生效门槛'), '实际：' + joined)
    assert.ok(zhReportTexts.includes('0%'), '实际：' + joined)
    assert.ok(joined.includes('最近命中：'), '实际：' + joined)
    assert.ok(joined.includes('符号填充'), '实际：' + joined)
    assert.ok(joined.includes('注入 成功'), '实际：' + joined)
  })

  locale.setLocale('en')
  const enTexts = texts(section.Component({}))
  check('英文界面：导航与正文切到英文', () => {
    assert.equal(section.options.label(), 'Doom Loop Guard')
    assert.ok(enTexts.includes('Protection level'))
    assert.ok(enTexts.includes('History report'))
  })
  check('英文界面：不再残留中文正文', () => {
    const han = /[\u4e00-\u9fff]/
    const leftovers = enTexts.filter((s) => han.test(s))
    assert.deepEqual(leftovers, [], '仍显示中文：' + leftovers.join(' | '))
  })
  check('英文界面：数字插值生效', () => {
    const joined = enTexts.join(' | ')
    assert.ok(joined.includes('Scanned 653 sessions'), '实际：' + joined)
    assert.ok(joined.includes('Activation threshold'), '实际：' + joined)
    assert.ok(enTexts.includes('0%'), '实际：' + joined)
    assert.ok(joined.includes('Last hit:'), '实际：' + joined)
    assert.ok(joined.includes('Symbol padding'), '实际：' + joined)
    assert.ok(joined.includes('injected ok'), '实际：' + joined)
  })
  check('英文界面：显示六个音色', () => {
    for (const name of ['Pulse', 'Triple', 'Rise', 'Sting', 'Ticks', 'Alarm']) {
      assert.ok(enTexts.includes(name), name)
    }
  })
}

console.log(`\n${passed} checks passed`)
