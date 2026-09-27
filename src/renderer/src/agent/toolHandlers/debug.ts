/** Debugger tools → main-process DebugManager (DAP adapters + Node inspector). */

import { resolveToolPath } from '../pathUtils'
import { sessionKeyOf } from './runtime'
import type { ToolHandler } from './types'

const unavailable = (id: string) => ({
  toolCallId: id,
  content: 'The debugger is only available in the desktop app (or pawn-headless).',
  isError: true
})

function keyFor(ctx: Parameters<ToolHandler>[3]): string {
  return sessionKeyOf(ctx).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120)
}

const debug_start: ToolHandler = async (call, projectPath, _s, ctx, api) => {
  if (!api.debug?.start) return unavailable(call.id)
  const a = call.arguments
  const program = typeof a.program === 'string' ? a.program : ''
  if (!program) return { toolCallId: call.id, content: 'program is required', isError: true }
  const cwd = resolveToolPath((a.cwd as string) || projectPath || '.', projectPath)
  const bps = Array.isArray(a.breakpoints)
    ? a.breakpoints
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => ({ path: resolveToolPath(String(b.path || ''), projectPath), line: Number(b.line), ...(typeof b.condition === 'string' ? { condition: b.condition } : {}) }))
    : []
  const res = await api.debug.start({
    sessionKey: keyFor(ctx),
    program: /^[/~]|^[A-Za-z]:\\/.test(program) ? program : resolveToolPath(program, projectPath),
    args: Array.isArray(a.args) ? a.args.map(String) : [],
    language: typeof a.language === 'string' ? a.language : 'auto',
    breakpoints: bps,
    stopOnEntry: a.stop_on_entry === true,
    cwd,
    env: a.env && typeof a.env === 'object' ? a.env : undefined,
    runtimeExecutable: typeof a.runtime_executable === 'string' ? a.runtime_executable : undefined,
    runtimeArgs: Array.isArray(a.runtime_args) ? a.runtime_args.map(String) : undefined
  })
  return res.ok ? { toolCallId: call.id, content: res.text || '' } : { toolCallId: call.id, content: res.error || 'debug_start failed', isError: true }
}

const debug_breakpoints: ToolHandler = async (call, projectPath, _s, ctx, api) => {
  if (!api.debug?.setBreakpoints) return unavailable(call.id)
  const path = typeof call.arguments.path === 'string' ? resolveToolPath(call.arguments.path, projectPath) : ''
  if (!path) return { toolCallId: call.id, content: 'path is required', isError: true }
  const raw = Array.isArray(call.arguments.lines) ? call.arguments.lines : []
  const lines = raw.map((l) => (typeof l === 'number' ? { line: l } : (l as { line: number; condition?: string })))
  const res = await api.debug.setBreakpoints(keyFor(ctx), path, lines)
  return res.ok ? { toolCallId: call.id, content: res.text || '' } : { toolCallId: call.id, content: res.error || 'failed', isError: true }
}

const ACTIONS: Record<string, 'continue' | 'over' | 'into' | 'out' | 'pause' | 'state'> = {
  continue: 'continue',
  step_over: 'over',
  step_into: 'into',
  step_out: 'out',
  over: 'over',
  into: 'into',
  out: 'out',
  pause: 'pause',
  state: 'state'
}

const debug_control: ToolHandler = async (call, _p, _s, ctx, api) => {
  if (!api.debug?.control) return unavailable(call.id)
  const action = ACTIONS[String(call.arguments.action || '')]
  if (!action) return { toolCallId: call.id, content: 'action must be continue | step_over | step_into | step_out | pause | state', isError: true }
  const t = Number(call.arguments.timeout)
  const res = await api.debug.control(keyFor(ctx), action, Number.isFinite(t) && t > 0 ? t * 1000 : undefined)
  return res.ok ? { toolCallId: call.id, content: res.text || '' } : { toolCallId: call.id, content: res.error || 'failed', isError: true }
}

const debug_eval: ToolHandler = async (call, _p, _s, ctx, api) => {
  if (!api.debug?.evaluate) return unavailable(call.id)
  const expr = typeof call.arguments.expression === 'string' ? call.arguments.expression : ''
  const frame = Number(call.arguments.frame_id)
  const res = await api.debug.evaluate(keyFor(ctx), expr, Number.isFinite(frame) ? frame : undefined)
  return res.ok
    ? { toolCallId: call.id, content: `${expr} = ${res.result}${res.type ? `  (${res.type})` : ''}` }
    : { toolCallId: call.id, content: res.error || 'evaluation failed', isError: true }
}

const debug_stop: ToolHandler = async (call, _p, _s, ctx, api) => {
  if (!api.debug?.stop) return unavailable(call.id)
  const res = await api.debug.stop(keyFor(ctx))
  return res.ok ? { toolCallId: call.id, content: 'Debug session ended.' } : { toolCallId: call.id, content: res.error || 'failed', isError: true }
}

export const debugHandlers: Record<string, ToolHandler> = {
  debug_start,
  debug_breakpoints,
  debug_control,
  debug_eval,
  debug_stop
}
