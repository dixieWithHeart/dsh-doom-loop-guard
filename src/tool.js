/**
 * 工具：doom_loop_report
 *
 * 宿主的硬契约（缺一样就静默注册失败）：
 *   · output 必须存在且 output.render 是函数
 *   · parameters 是原生 JSON Schema
 *   · output.schema 必须显式写 additionalProperties
 */

import { TOOL_NAME } from './constants.js'
import { buildReport } from './report.js'

export function createToolDefinition ({ getOptions }) {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    properties: {
      days: { type: 'number', description: '只扫描最近 N 天的会话（默认取插件设置，7）。' },
      limit: { type: 'number', description: '最多返回多少个会话（默认取插件设置，20）。' },
      verbose: { type: 'boolean', description: '是否附带每条命中的片段（默认 false）。' }
    }
  }

  const execute = async (args) => {
    const options = { ...getOptions() }
    if (args && Number.isFinite(Number(args.days))) options.reportDays = Math.min(3650, Math.max(1, Number(args.days)))
    if (args && Number.isFinite(Number(args.limit))) options.reportLimit = Math.min(200, Math.max(1, Number(args.limit)))
    const verbose = Boolean(args && args.verbose === true)

    let report
    try {
      report = await buildReport(options, { info: () => {}, warn: () => {} })
    } catch (error) {
      return { ok: false, error: `scan failed: ${error instanceof Error ? error.message : String(error)}` }
    }

    const sessions = report.sessions.map((s) => {
      const item = {
        id: s.id,
        cwd: s.cwd,
        collapsedCount: s.collapsedCount,
        reasoningCount: s.reasoningCount,
        worst: s.hits[0] ? { chars: s.hits[0].chars, kind: s.hits[0].kind, detail: s.hits[0].detail } : null
      }
      if (verbose) item.hits = s.hits.slice(0, 5)
      return item
    })

    return {
      ok: true,
      root: report.root,
      scanned: report.scanned,
      failed: report.failed,
      totalCollapsedSessions: report.totalCollapsedSessions,
      sessions
    }
  }

  return {
    name: TOOL_NAME,
    description: '扫描 DSH 会话存档，列出推理出现重复循环（符号填充 / 低信息循环）的会话排行。',
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    execute
  }
}
