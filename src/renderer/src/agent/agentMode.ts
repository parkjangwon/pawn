/**
 * Plan / Build agent modes (OpenCode/Cline-inspired, thin-harness style).
 *
 * Plan  — explore & design only (no mutating tools exposed or executable).
 * Build — full tool surface (permissionMode still applies).
 *
 * This is a tool allowlist switch, not a multi-agent team.
 */

export type AgentMode = 'plan' | 'build'

/** Tools that may change disk, OS, remote state, or side-effect the world. */
const MUTATING_PREFIXES = [
  'write_',
  'edit_',
  'delete_',
  'shell_',
  'computer_',
  'debug_',
  'install_',
  'app_create_',
  'wiki_write',
  'wiki_rename',
  'wiki_delete',
  'github_create_',
  'github_comment',
  'github_draft_',
  'gitlab_create_',
  'gitlab_comment'
] as const

const MUTATING_EXACT = new Set([
  'apply_patch',
  'bash',
  'lsp_rename',
  'lsp_apply_code_action',
  'checkpoint_restore',
  'str_replace_based_edit_tool',
  'browser_click',
  'browser_fill',
  'browser_eval',
  'browser_open_external',
  'app_set_permission_mode', // avoid plan elevating to yolo via tools
  'app_set_agent_mode', // plan must not self-promote to build; only the user switches
  'app_set_model',
  'run_checks', // executes project scripts (package.json/Makefile), so it is shell-equivalent
  'git_add',
  'git_commit',
  'git_push',
  'git_branch',
  'git_stash',
  'spawn_agent',
  'parallel_agents',
  'google_gmail_send',
  'google_sheets_write',
  'google_calendar_create',
  'save_skill'
])

/** Explicitly allowed mutators that are actually planning (none currently). */
const PLAN_EXTRA_ALLOW = new Set([
  'update_plan',
  'shell_wait',
  'working_notes',
  'project_profile',
  'repo_map',
  'load_skill',
  'load_tools',
  'ask_user',
  'request_plan_approval',
  'app_set_reasoning',
  'app_open_tab',
  'app_close_tab',
  'app_list_automations',
  'app_toggle_theme'
])

export function isMutatingTool(name: string): boolean {
  if (PLAN_EXTRA_ALLOW.has(name)) return false
  // Observational shell helpers are not mutations
  if (name === 'shell_poll') return false
  if (MUTATING_EXACT.has(name)) return true
  if (name.startsWith('mcp__')) return true // MCP may side-effect; plan keeps read-only surface
  for (const p of MUTATING_PREFIXES) {
    if (name.startsWith(p) || name === p.replace(/_$/, '')) return true
  }
  return false
}

export function isToolAllowedInAgentMode(name: string, mode: AgentMode): boolean {
  if (mode === 'build') return true
  return !isMutatingTool(name)
}

export function planModeBlockMessage(toolName: string): string {
  return (
    `Blocked in Plan mode: \`${toolName}\` can change the system.\n` +
    `Switch to **Build** (composer chip or Tab) to edit files, run shell, or use computer/browser actions.\n` +
    `In Plan mode: read, search, repo_map, git inspect, web research, update_plan.`
  )
}

export function filterToolsForAgentMode<T extends { name: string }>(tools: T[], mode: AgentMode): T[] {
  if (mode === 'build') return tools
  return tools.filter((t) => isToolAllowedInAgentMode(t.name, mode))
}

export type DoneGate = 'off' | 'typecheck' | 'test'

export function parseDoneGate(raw: unknown): DoneGate {
  if (raw === 'typecheck' || raw === 'test' || raw === 'off') return raw
  return 'typecheck'
}

export function parseAgentMode(raw: unknown): AgentMode {
  return raw === 'plan' ? 'plan' : 'build'
}
