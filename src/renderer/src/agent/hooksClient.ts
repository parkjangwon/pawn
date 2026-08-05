/**
 * Thin client for main-process lifecycle hooks.
 * Safe no-op when desktop API is missing (dev:web / tests).
 */

export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'Stop'

export interface HookFireResult {
  ok: boolean
  decision: 'allow' | 'deny' | 'ask' | 'none'
  reason?: string
  additionalContext: string[]
  ran: number
  errors: string[]
}

const empty: HookFireResult = {
  ok: true,
  decision: 'none',
  additionalContext: [],
  ran: 0,
  errors: []
}

export async function fireHook(input: {
  event: HookEventName
  sessionId?: string
  projectPath?: string | null
  cwd?: string
  payload?: Record<string, unknown>
}): Promise<HookFireResult> {
  if (!window.api?.hooks?.run) return empty
  try {
    const res = await window.api.hooks.run(input)
    return {
      ok: res?.ok !== false,
      decision: (res?.decision as HookFireResult['decision']) || 'none',
      reason: res?.reason,
      additionalContext: Array.isArray(res?.additionalContext) ? res.additionalContext : [],
      ran: Number(res?.ran || 0),
      errors: Array.isArray(res?.errors) ? res.errors : []
    }
  } catch {
    return empty
  }
}
