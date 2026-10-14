/**
 * Observe-only mod events for the Claude Code hooks Pawn used to accept but
 * never emit:
 *
 * | Claude Code          | Pawn event       | When                                    |
 * |----------------------|------------------|-----------------------------------------|
 * | `PostToolUse`        | `tool.result`    | A tool ran and returned a result        |
 * | `PostToolUseFailure` | `tool.error`     | A tool ran and failed (error result/throw) |
 * | `SubagentStart`      | `subagent.start` | A subagent run begins                   |
 * | `SubagentStop`       | `subagent.stop`  | A subagent run ends (ok, error, aborted) |
 *
 * Every emit is fire-and-forget: it is not awaited by the tool or subagent,
 * the payload is frozen by the runtime, a throwing or slow hook is skipped by
 * the runtime (10 s budget), and any rejection is swallowed here. A mod can
 * observe but cannot change the result or block anything.
 *
 * Payloads carry the Claude Code field names (`tool_name`, `tool_input`,
 * `tool_response`, `error`, `agent_id`, `agent_type`) plus `tool` / `sessionId`
 * so Pawn-style matchers such as `{ tool: 'shell_exec' }` work.
 */
import { getModRuntime } from './runtime'

const MAX_TEXT = 20_000
const MAX_INPUT = 20_000

function clip(s: unknown, n = MAX_TEXT): string {
  return String(s ?? '').slice(0, n)
}

/** Tool arguments, size-capped (large file writes are trimmed per string field). */
function boundedInput(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = typeof v === 'string' ? v.slice(0, MAX_INPUT) : v
  }
  try {
    if (JSON.stringify(out).length > 4 * MAX_INPUT) return { truncated: true }
  } catch {
    return { truncated: true }
  }
  return out
}

function fire(event: string, payload: Record<string, unknown>, sessionId?: string): void {
  try {
    const rt = getModRuntime()
    if (!rt.hasHooks(event)) return
    void rt.emit(event, payload, async (e) => e, undefined, sessionId).catch(() => {})
  } catch {
    /* a mod can never break the caller */
  }
}

export interface ToolOutcome {
  sessionId?: string
  tool: string
  toolUseId: string
  input: Record<string, unknown> | undefined
  content: string
  isError: boolean
}

/** `tool.result` (PostToolUse) on success, `tool.error` (PostToolUseFailure) on failure. */
export function modToolOutcome(o: ToolOutcome): void {
  const base = {
    ...(o.sessionId ? { sessionId: o.sessionId } : {}),
    tool: o.tool,
    tool_name: o.tool,
    tool_use_id: o.toolUseId,
    tool_input: boundedInput(o.input)
  }
  if (o.isError) {
    fire('tool.error', { ...base, error: clip(o.content) }, o.sessionId)
  } else {
    fire('tool.result', { ...base, tool_response: { content: clip(o.content), isError: false } }, o.sessionId)
  }
}

export interface SubagentStartInfo {
  sessionId?: string
  runId: string
  agent: string
  name: string
  prompt: string
  background: boolean
}

export function modSubagentStart(i: SubagentStartInfo): void {
  fire(
    'subagent.start',
    {
      ...(i.sessionId ? { sessionId: i.sessionId } : {}),
      agent_id: i.runId,
      agent_type: i.agent,
      name: i.name,
      prompt: clip(i.prompt, 4_000),
      background: i.background
    },
    i.sessionId
  )
}

export interface SubagentStopInfo {
  sessionId?: string
  runId: string
  agent: string
  name: string
  status: 'ok' | 'error' | 'aborted'
  summary: string
  error?: string
  rounds: number
  toolsUsed: string[]
  filesChanged?: string[]
}

export function modSubagentStop(i: SubagentStopInfo): void {
  fire(
    'subagent.stop',
    {
      ...(i.sessionId ? { sessionId: i.sessionId } : {}),
      agent_id: i.runId,
      agent_type: i.agent,
      name: i.name,
      status: i.status,
      ok: i.status === 'ok',
      summary: clip(i.summary),
      ...(i.error ? { error: clip(i.error, 4_000) } : {}),
      rounds: i.rounds,
      toolsUsed: i.toolsUsed.slice(0, 64),
      filesChanged: (i.filesChanged || []).slice(0, 200)
    },
    i.sessionId
  )
}
