/** Claude/Codex-compatible lifecycle hooks (subset + Pawn tool names). */

export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'Stop'

export type HookHandlerType = 'command' | 'http'

export interface HookHandler {
  type: HookHandlerType
  /** Shell command (shell form). */
  command?: string
  /** HTTP URL for type http. */
  url?: string
  timeout?: number
  statusMessage?: string
  async?: boolean
}

export interface HookMatcherGroup {
  matcher?: string
  hooks: HookHandler[]
}

export type HooksConfig = Partial<Record<HookEventName, HookMatcherGroup[]>>

export type HookSource =
  | 'claude:user'
  | 'claude:project'
  | 'pawn:user'
  | 'pawn:project'

export interface LoadedHook {
  id: string
  event: HookEventName
  matcher: string
  handler: HookHandler
  source: HookSource
  /** For dedupe / display */
  fingerprint: string
}

export interface HooksSettings {
  /** Master switch */
  enabled: boolean
  /** Load hooks from ~/.claude and project .claude/settings.json */
  readClaude: boolean
  /** Load hooks from ~/.pawn/hooks.json and project .pawn/hooks.json */
  readPawn: boolean
}

export const DEFAULT_HOOKS_SETTINGS: HooksSettings = {
  enabled: true,
  readClaude: true,
  readPawn: true
}

export const HOOK_EVENTS: HookEventName[] = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
]

export interface HookRunInput {
  event: HookEventName
  sessionId?: string
  projectPath?: string | null
  cwd?: string
  /** Free-form payload fields merged into stdin JSON */
  payload?: Record<string, unknown>
}

export type HookDecision = 'allow' | 'deny' | 'ask' | 'none'

export interface HookRunResult {
  ok: boolean
  decision: HookDecision
  reason?: string
  /** Extra context snippets from hooks (optional model context) */
  additionalContext: string[]
  ran: number
  errors: string[]
}
