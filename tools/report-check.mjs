// 用真实 DSH 会话存档验证事后分析链路
import { DEFAULTS } from '../src/constants.js'
import { buildReport } from '../src/report.js'

const days = Number(process.argv[2] || 7)
const report = await buildReport(
  { ...DEFAULTS, reportDays: days, reportLimit: 10 },
  { info: () => {}, warn: (m) => console.warn('warn:', m) }
)

console.log(JSON.stringify({
  root: report.root,
  scanned: report.scanned,
  failed: report.failed,
  totalCollapsedSessions: report.totalCollapsedSessions,
  trend: report.trend,
  top: report.sessions.map((s) => ({
    id: s.id,
    cwd: s.cwd,
    doom: s.doom,
    collapsed: s.collapsedCount,
    reasoning: s.reasoningCount,
    worstChars: s.hits[0] ? s.hits[0].chars : 0,
    worstDetail: s.hits[0] ? s.hits[0].detail : '',
    samples: s.hits.slice(0, 3).map((h) => h.head.slice(0, 120))
  }))
}, null, 2))
