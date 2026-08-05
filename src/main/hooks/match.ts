import type { HookEventName, LoadedHook } from './types'

/** Claude-style tool name aliases so matchers like Bash|Write still work. */
const TOOL_ALIASES: Record<string, string[]> = {
  shell_exec: ['shell_exec', 'Bash', 'bash'],
  shell_kill: ['shell_kill', 'Bash', 'bash'],
  shell_poll: ['shell_poll', 'Bash', 'bash'],
  run_checks: ['run_checks', 'Bash', 'bash'],
  write_file: ['write_file', 'Write', 'Edit'],
  edit_file: ['edit_file', 'Edit', 'Write'],
  delete_file: ['delete_file', 'Write', 'Edit'],
  read_file: ['read_file', 'Read'],
  list_dir: ['list_dir', 'LS'],
  search_files: ['search_files', 'Glob'],
  grep_search: ['grep_search', 'Grep'],
  write_artifact: ['write_artifact', 'Write'],
  memory_save: ['memory_save', 'Write'],
  memory_forget: ['memory_forget', 'Write'],
  memory_update: ['memory_update', 'Write']
}

export function expandToolNames(toolName: string): string[] {
  if (toolName.startsWith('mcp__')) {
    return [toolName, 'mcp', 'MCP']
  }
  const extra = TOOL_ALIASES[toolName]
  if (extra) return extra
  return [toolName]
}

/**
 * Claude matcher rules (simplified):
 * - empty / * / omitted → match all
 * - only safe chars → exact or pipe/comma list
 * - otherwise → regex (unanchored)
 */
export function matcherMatches(matcher: string | undefined, value: string): boolean {
  const m = (matcher ?? '').trim()
  if (!m || m === '*') return true

  const exactSafe = /^[A-Za-z0-9_|,\s-]+$/.test(m)
  if (exactSafe) {
    const parts = m
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) return true
    return parts.some((p) => p === value || p === '*')
  }

  try {
    return new RegExp(m).test(value)
  } catch {
    return m === value
  }
}

export function hookMatchesEvent(
  hook: LoadedHook,
  event: HookEventName,
  context: { toolName?: string; source?: string; reason?: string }
): boolean {
  if (hook.event !== event) return false

  const m = hook.matcher
  if (!m || m === '*') return true

  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PermissionRequest': {
      const names = expandToolNames(context.toolName || '')
      return names.some((n) => matcherMatches(m, n))
    }
    case 'SessionStart':
      return matcherMatches(m, context.source || 'startup')
    case 'SessionEnd':
      return matcherMatches(m, context.reason || 'other')
    case 'UserPromptSubmit':
    case 'Stop':
      // Claude: matcher ignored / always fires
      return true
    default:
      return matcherMatches(m, context.toolName || '')
  }
}
