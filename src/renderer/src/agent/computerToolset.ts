/**
 * Anthropic's native computer-use tool for Claude on the Anthropic API.
 *
 * Claude is trained on its own computer tool; declaring it (instead of
 * Pawn's computer_* function tools) gives the best click accuracy and lets
 * Claude batch several actions per turn. Three wire versions exist:
 *
 *   computer_toolset_20260801  Claude 5.5+ (members like left_click with
 *                              toolset_name "computer"; no beta header)
 *   computer_20251124          Opus 4.5–5.x, Sonnet 4.6/5, Fable/Mythos 5.x
 *                              (one tool "computer", input.action; beta header)
 *   computer_20250124          Sonnet 4.5, Haiku 4.5, Opus 4/4.1, Sonnet 4
 *
 * All versions execute through the same engine actions and share the
 * screenshot coordinate space with Pawn's own computer_* tools, which stay
 * available for the things Claude's tool lacks (accessibility elements, OCR,
 * apps, windows, menus).
 */

import type { ToolCall } from './toolDefinitionsTypes'

export type ClaudeComputerVersion = 'toolset_20260801' | 'computer_20251124' | 'computer_20250124'

export const COMPUTER_HALT_TEXT = 'Not executed: an earlier computer action in this turn failed.'

/** Pawn function tools that duplicate the native tool (dropped when it's declared). */
export const NATIVE_DUPLICATES = new Set([
  'computer_screenshot',
  'computer_zoom',
  'computer_click',
  'computer_type',
  'computer_key',
  'computer_scroll',
  'computer_drag',
  'computer_mouse',
  'computer_hold_key',
  'computer_wait'
])

export const TOOLSET_MEMBERS = [
  'screenshot',
  'zoom',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'left_click_drag',
  'mouse_move',
  'left_mouse_down',
  'left_mouse_up',
  'cursor_position',
  'scroll',
  'type',
  'key',
  'hold_key',
  'wait'
] as const

/** Parse "claude-opus-5-5", "claude-sonnet-4-6-20260101", "claude-haiku-4-5". */
export function claudeModelVersion(modelId: string): { family: string; version: number } | null {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d{1,2}))?(?![\d])/i.exec(modelId || '')
  if (!m) return null
  const major = Number(m[2])
  const minor = m[3] !== undefined ? Number(m[3]) : 0
  return { family: m[1].toLowerCase(), version: major + minor / 10 }
}

export function claudeComputerVersion(modelId: string): ClaudeComputerVersion | null {
  const v = claudeModelVersion(modelId)
  if (!v) return null
  const { family, version } = v
  if (version >= 5.5) return 'toolset_20260801'
  if (family === 'fable' || family === 'mythos') return version >= 5 ? 'computer_20251124' : null
  if (family === 'opus' && version >= 4.5) return 'computer_20251124'
  if (family === 'sonnet' && version >= 4.6) return 'computer_20251124'
  if (family === 'sonnet' && version >= 4) return 'computer_20250124'
  if (family === 'haiku' && version >= 4.5) return 'computer_20250124'
  if (family === 'opus' && version >= 4) return 'computer_20250124'
  return null
}

export function isOfficialAnthropic(baseUrl: string | undefined): boolean {
  try {
    return new URL(baseUrl || '').hostname.replace(/^www\./, '') === 'api.anthropic.com'
  } catch {
    return false
  }
}

export interface NativeComputerPlan {
  version: ClaudeComputerVersion
  /** tools[] entry to declare. */
  entry: Record<string, unknown>
  betaHeader?: string
}

/**
 * Decide whether to declare the native tool for this request.
 * `toolNames` = Pawn tools already in the request (after mode / diet / policy
 * filtering): the native tool is only added when acting is allowed.
 */
export function planNativeComputer(opts: {
  apiFormat: string
  baseUrl: string | undefined
  modelId: string
  toolNames: string[]
  desktop: boolean
  display?: { width: number; height: number }
  enabled?: boolean
}): NativeComputerPlan | null {
  if (opts.enabled === false || !opts.desktop) return null
  if (opts.apiFormat !== 'claude' || !isOfficialAnthropic(opts.baseUrl)) return null
  if (!opts.toolNames.includes('computer_screenshot') || !opts.toolNames.includes('computer_click')) return null
  const version = claudeComputerVersion(opts.modelId)
  if (!version) return null
  if (version === 'toolset_20260801') {
    return { version, entry: { type: 'computer_toolset_20260801' } }
  }
  if (!opts.display) return null
  const entry: Record<string, unknown> = {
    type: version,
    name: 'computer',
    display_width_px: opts.display.width,
    display_height_px: opts.display.height
  }
  if (version === 'computer_20251124') entry.enable_zoom = true
  return {
    version,
    entry,
    betaHeader: version === 'computer_20251124' ? 'computer-use-2025-11-24' : 'computer-use-2025-01-24'
  }
}

/** True for any call that acts on the desktop (native or Pawn tool). */
export function isComputerCall(tc: Pick<ToolCall, 'name' | 'toolset'>): boolean {
  return tc.toolset === 'computer' || tc.name === 'computer' || tc.name.startsWith('computer_')
}

/** True for a native Claude computer-tool call (either wire version). */
export function isNativeComputerCall(tc: Pick<ToolCall, 'name' | 'toolset'>): boolean {
  return tc.toolset === 'computer' || tc.name === 'computer'
}

/** Engine action + args for a native call. */
export function nativeCallToAction(tc: Pick<ToolCall, 'name' | 'toolset' | 'arguments'>): { action: string; args: Record<string, unknown> } {
  if (tc.toolset === 'computer') return { action: tc.name, args: { ...tc.arguments } }
  const { action, ...rest } = tc.arguments || {}
  return { action: String(action || ''), args: rest }
}

/** Name used for permissions / plan-mode / safety tables. */
export function permissionName(tc: Pick<ToolCall, 'name' | 'toolset' | 'arguments'>): string {
  if (!isNativeComputerCall(tc)) return tc.name
  const { action } = nativeCallToAction(tc)
  return `computer_${action || 'action'}`
}

/** Whether a batch's last computer action already shows the screen. */
export function endsWithObservation(calls: Array<Pick<ToolCall, 'name' | 'toolset' | 'arguments'>>): boolean {
  const last = [...calls].reverse().find(isComputerCall)
  if (!last) return true
  const action = isNativeComputerCall(last) ? nativeCallToAction(last).action : last.name.replace(/^computer_/, '')
  return action === 'screenshot' || action === 'zoom' || last.arguments?.return_screenshot === true
}
