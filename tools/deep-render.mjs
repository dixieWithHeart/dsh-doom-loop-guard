// 深度渲染检查：递归执行所有函数组件，捕获真实运行期错误（test-client-render 只渲染顶层）
import { pathToFileURL } from 'node:url'

const FILE = process.argv[2] || new URL('../client.js', import.meta.url).pathname.replace(/^\//, '')

const STATE = {
  version: '0.4.0',
  settings: {
    enabled: true,
    maxDashRun: 300,
    maxParenRun: 60,
    shortSentenceRepeat: 15,
    maxRepeatGap: 15,
    shortRepeatRatio: 0.2,
    windowChars: 4000,
    pressureSensitivity: true,
    pressureBoostStart: 50,
    pressureBoostMax: 0.6,
    reportDays: 7,
    reportLimit: 20
  },
  sessionsRoot: '<home>/.dsh/sessions'
}

const REPORT = {
  ok: true,
  root: '<home>/.dsh/sessions',
  scanned: 653,
  failed: 0,
  totalCollapsedSessions: 2,
  trend: Array.from({ length: 14 }, (_, i) => ({
    date: `10/${i + 1}`,
    sessions: i % 5,
    collapsed: i % 2,
    avgDoom: (i * 7) % 100
  })),
  sessions: [
    {
      id: 'session-aaa',
      cwd: 'D:\\0_code_codes\\drg_mod',
      doom: 71,
      collapsedCount: 33,
      reasoningCount: 258,
      hits: [{ seq: 1, chars: 15201, kind: 'symbol', detail: '连续破折号填充 12144 字符', head: '**验证结果**' }]
    },
    {
      id: 'session-bbb',
      cwd: 'D:\\0_code_codes\\pi',
      doom: 12,
      collapsedCount: 1,
      reasoningCount: 200,
      hits: [{ seq: 2, chars: 500, kind: 'loop', detail: '同一短句重复 20 次', head: '好。执行。' }]
    }
  ]
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
globalThis.fetch = async (url) => {
  const body = String(url).includes('/report') ? REPORT : STATE
  return { ok: true, status: 200, json: async () => body }
}
globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

await import(pathToFileURL(FILE).href)
const plugin = loaded.factory((name) => {
  if (name === 'react') return makeReact()
  throw new Error('unexpected require: ' + name)
})

const registered = []
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  slots: {
    inject: (key, cb) => { cb(); return () => {} },
    register: (options, Component) => { registered.push({ options, Component }); return () => {} }
  }
}
plugin.apply(ctx)

const target = registered.find((r) => r.options && r.options.name === 'settings.section')
if (!target) {
  console.log('FAIL 没有注册 settings.section')
  process.exit(1)
}

const errors = []
function walk (node, depth, path) {
  if (!node || depth > 40) return
  if (typeof node.type === 'function') {
    const name = node.type.name || 'Anonymous'
    try {
      const child = node.type(node.props || {})
      walk(child, depth + 1, path + '/' + name)
    } catch (e) {
      errors.push(`${path}/${name}: ${e && e.message}`)
    }
    return
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) walk(c, depth + 1, path)
  }
}

let tree = null
try {
  tree = target.Component({})
} catch (e) {
  console.log('FAIL 顶层组件抛错: ' + (e && e.message))
  process.exit(1)
}
walk(tree, 0, 'SettingsPage')

if (errors.length) {
  console.log('FAIL 子组件抛错:')
  for (const e of errors) console.log('  ' + e)
  process.exit(1)
}
console.log('ok  全部组件渲染通过')
