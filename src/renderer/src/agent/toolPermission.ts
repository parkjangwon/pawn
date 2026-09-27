import { useProviderStore } from '../stores/provider'
import { usePermissionStore, type PermissionRisk, type PermissionType } from '../stores/permission'
import { resolveToolPath } from './pathUtils'
import { fireHook } from './hooksClient'
import { isToolAllowedInAgentMode } from './agentMode'
import { buildPermissionPreview } from './permissionPreview'
import { assessShellRisk, decisionFeatureOn, type ShellRisk } from './decision'

export type SafetyLevel = 'safe' | 'risky'

/**
 * Tools that are side-effect free locally (so TOOL_SAFETY keeps them 'safe' for
 * parallel batching) but can carry data off the machine via URLs, or persist
 * model-chosen content. A prompt-injected model could otherwise exfiltrate
 * secrets through a query string without any prompt in auto mode.
 */
export const NEEDS_APPROVAL_IN_AUTO = new Set<string>([
  'web_fetch',
  'web_research',
  'browser_navigate',
  'memory_save'
])

/** Whether a tool may run without a user prompt under the given permission mode. */
export function autoApproves(callName: string, mode: 'ask' | 'auto' | 'yolo', hidden: boolean): boolean {
  if (mode === 'yolo') return true
  const safety = TOOL_SAFETY[callName] || 'risky'
  if (safety !== 'safe' || NEEDS_APPROVAL_IN_AUTO.has(callName)) return false
  return mode === 'auto' || (mode === 'ask' && hidden)
}

export const TOOL_SAFETY: Record<string, SafetyLevel> = {
  read_file: 'safe',
  read_spreadsheet: 'safe',
  list_dir: 'safe',
  load_skill: 'safe',
  load_tools: 'safe',
  lsp_diagnostics: 'safe',
  lsp_definition: 'safe',
  lsp_references: 'safe',
  lsp_hover: 'safe',
  lsp_symbols: 'safe',
  lsp_call_hierarchy: 'safe',
  lsp_code_actions: 'safe',
  lsp_rename: 'risky',
  lsp_apply_code_action: 'risky',
  semantic_search: 'safe',
  affected_tests: 'safe',
  read_output: 'safe',
  shell_wait: 'safe',
  browser_console: 'safe',
  browser_network: 'safe',
  // Serial: they read/modify shared session state.
  working_notes: 'risky',
  checkpoint_mark: 'risky',
  checkpoint_restore: 'risky',
  project_profile: 'risky',
  debug_start: 'risky',
  debug_breakpoints: 'risky',
  debug_control: 'risky',
  debug_eval: 'risky',
  debug_stop: 'risky',
  // Interactive, but no side effects; kept 'risky' so it runs serially after
  // parallel reads instead of racing them.
  ask_user: 'risky',
  request_plan_approval: 'risky',
  search_files: 'safe',
  grep_search: 'safe',
  git_status: 'safe',
  git_diff: 'safe',
  git_log: 'safe',
  git_pr_ready: 'safe',
  git_add: 'risky',
  git_commit: 'risky',
  git_push: 'risky',
  git_branch: 'risky',
  git_stash: 'risky',
  run_checks: 'risky',
  codebase_search: 'safe',
  write_artifact: 'risky',
  list_artifacts: 'safe',
  spawn_agent: 'risky',
  parallel_agents: 'risky',
  research_report: 'risky',
  list_agents: 'safe',
  await_agent: 'safe',
  cancel_agent: 'risky',
  terminal_list: 'safe',
  terminal_read: 'safe',
  web_search: 'safe',
  memory_search: 'safe',
  memory_list: 'safe',
  memory_save: 'safe',
  // Typed judgment by the user-configured decision provider (fixed endpoint,
  // secrets redacted in main); no local side effects.
  decide: 'safe',
  save_skill: 'risky',
  memory_forget: 'risky',
  memory_update: 'risky',
  update_plan: 'safe',
  repo_map: 'safe',
  issue_to_pr: 'safe',
  app_set_agent_mode: 'safe',
  shell_poll: 'safe',
  browser_navigate: 'safe',
  browser_snapshot: 'safe',
  browser_read_text: 'safe',
  browser_screenshot: 'safe',
  browser_back: 'safe',
  browser_wait: 'safe',
  browser_scroll: 'safe',
  install_skill: 'risky',
  browser_open_external: 'risky',
  browser_click: 'risky',
  browser_fill: 'risky',
  browser_select: 'risky',
  browser_eval: 'risky',
  browser_tab_list: 'safe',
  browser_tab_new: 'risky',
  browser_tab_switch: 'risky',
  browser_tab_close: 'risky',
  web_fetch: 'safe',
  web_research: 'safe',
  write_file: 'risky',
  edit_file: 'risky',
  apply_patch: 'risky',
  // Model-native tools are mapped to read_file / write_file / edit_file /
  // shell_exec for safety & permissions (toolIdentity.effectiveToolName).
  str_replace_based_edit_tool: 'risky',
  bash: 'risky',
  delete_file: 'risky',
  shell_exec: 'risky',
  shell_kill: 'risky',
  // Computer use runs serially ('risky') so a batch executes in order.
  computer_screenshot: 'risky',
  computer_zoom: 'risky',
  computer_displays: 'safe',
  computer_status: 'safe',
  computer_click: 'risky',
  computer_mouse: 'risky',
  computer_drag: 'risky',
  computer_scroll: 'risky',
  computer_type: 'risky',
  computer_key: 'risky',
  computer_hold_key: 'risky',
  computer_ui_snapshot: 'risky',
  computer_ui_action: 'risky',
  computer_find: 'risky',
  computer_ocr: 'risky',
  computer_apps: 'risky',
  computer_windows: 'risky',
  computer_menu: 'risky',
  computer_open: 'risky',
  computer_clipboard: 'risky',
  computer_wait: 'risky',
  app_open_tab: 'safe',
  app_close_tab: 'safe',
  app_list_automations: 'safe',
  app_create_automation: 'risky',
  app_set_model: 'safe',
  app_set_reasoning: 'safe',
  app_toggle_theme: 'safe',
  app_set_permission_mode: 'risky',
  // Google
  google_whoami: 'safe',
  google_drive_search: 'safe',
  google_drive_read: 'safe',
  google_gmail_search: 'safe',
  google_gmail_read: 'safe',
  google_gmail_send: 'risky',
  google_calendar_list: 'safe',
  google_calendar_create: 'risky',
  google_tasks_list: 'safe',
  google_sheets_read: 'safe',
  google_sheets_write: 'risky',
  google_docs_read: 'safe',
  google_slides_read: 'safe',
  memory_consolidate: 'risky',
  // GitHub
  github_whoami: 'safe',
  github_list_repos: 'safe',
  github_get_repo: 'safe',
  github_list_issues: 'safe',
  github_get_issue: 'safe',
  github_list_pulls: 'safe',
  github_get_pull: 'safe',
  github_review_pull: 'safe',
  github_list_commits: 'safe',
  github_get_file: 'safe',
  github_search_code: 'safe',
  github_search_issues: 'safe',
  github_create_issue: 'risky',
  github_draft_issue: 'risky',
  github_comment: 'risky',
  github_create_pull: 'risky',
  gitlab_whoami: 'safe',
  gitlab_list_projects: 'safe',
  gitlab_get_project: 'safe',
  gitlab_list_issues: 'safe',
  gitlab_get_issue: 'safe',
  gitlab_list_merge_requests: 'safe',
  gitlab_get_merge_request: 'safe',
  gitlab_list_commits: 'safe',
  gitlab_get_file: 'safe',
  gitlab_search: 'safe',
  gitlab_create_issue: 'risky',
  gitlab_comment: 'risky',
  gitlab_create_merge_request: 'risky',
  codecommit_whoami: 'safe',
  codecommit_list_repos: 'safe',
  codecommit_get_repo: 'safe',
  codecommit_list_branches: 'safe',
  codecommit_get_branch: 'safe',
  codecommit_list_commits: 'safe',
  codecommit_get_file: 'safe'
}

export type PermissionMode = 'ask' | 'auto' | 'yolo'

function permissionTypeFor(callName: string): PermissionType {
  if (callName.startsWith('mcp__')) return 'mcp'
  if (callName.startsWith('computer_')) return 'computer_use'
  const map: Record<string, PermissionType> = {
    // every computer_* tool (see prefix check below)
    browser_eval: 'browser',
    browser_click: 'browser',
    browser_fill: 'browser',
    browser_select: 'browser',
    browser_scroll: 'browser',
    browser_wait: 'browser',
    browser_open_external: 'browser',
    browser_tab_new: 'browser',
    browser_tab_list: 'browser',
    browser_tab_switch: 'browser',
    browser_tab_close: 'browser',
    shell_exec: 'shell_exec',
    shell_kill: 'shell_exec',
    // Debugging runs the program (shell-equivalent).
    debug_start: 'shell_exec',
    debug_breakpoints: 'shell_exec',
    debug_control: 'shell_exec',
    debug_eval: 'shell_exec',
    debug_stop: 'shell_exec',
    lsp_rename: 'file_write',
    lsp_apply_code_action: 'file_write',
    checkpoint_restore: 'file_write',
    checkpoint_mark: 'file_read',
    working_notes: 'file_read',
    project_profile: 'file_read',
    read_output: 'file_read',
    shell_wait: 'file_read',
    semantic_search: 'file_read',
    affected_tests: 'file_read',
    browser_console: 'browser',
    browser_network: 'browser',
    write_file: 'file_write',
    edit_file: 'file_write',
    apply_patch: 'file_write',
    delete_file: 'file_write',
    git_status: 'file_read',
    git_diff: 'file_read',
    git_log: 'file_read',
    git_pr_ready: 'file_read',
    git_add: 'shell_exec',
    git_commit: 'shell_exec',
    git_push: 'shell_exec',
    git_branch: 'shell_exec',
    git_stash: 'shell_exec',
    spawn_agent: 'shell_exec',
    parallel_agents: 'shell_exec',
    research_report: 'shell_exec',
    list_agents: 'file_read',
    await_agent: 'file_read',
    cancel_agent: 'shell_exec',
    google_gmail_send: 'file_write',
    google_sheets_write: 'file_write',
    google_calendar_create: 'file_write',
    run_checks: 'shell_exec',
    codebase_search: 'file_read',
    repo_map: 'file_read',
    issue_to_pr: 'file_read',
    app_set_agent_mode: 'app',
    write_artifact: 'file_write',
    list_artifacts: 'file_read',
    terminal_list: 'file_read',
    terminal_read: 'file_read',
    web_search: 'file_read',
    // Egress gets its own type so a session-wide file_read approval doesn't cover it.
    web_fetch: 'network',
    web_research: 'network',
    memory_search: 'file_read',
    memory_list: 'file_read',
    decide: 'file_read',
    save_skill: 'file_write',
    memory_save: 'file_write',
    memory_forget: 'file_write',
    memory_update: 'file_write',
    app_open_tab: 'app',
    app_close_tab: 'app',
    app_list_automations: 'app',
    app_create_automation: 'app',
    app_set_model: 'app',
    app_set_permission_mode: 'app',
    app_set_reasoning: 'app',
    app_toggle_theme: 'app',
    install_skill: 'app',
    google_whoami: 'file_read',
    google_drive_search: 'file_read',
    google_drive_read: 'file_read',
    google_gmail_search: 'file_read',
    google_gmail_read: 'file_read',
    google_calendar_list: 'file_read',
    google_tasks_list: 'file_read',
    google_sheets_read: 'file_read',
    google_docs_read: 'file_read',
    google_slides_read: 'file_read',
    github_whoami: 'file_read',
    github_list_repos: 'file_read',
    github_get_repo: 'file_read',
    github_list_issues: 'file_read',
    github_get_issue: 'file_read',
    github_list_pulls: 'file_read',
    github_get_pull: 'file_read',
    github_review_pull: 'file_read',
    github_list_commits: 'file_read',
    github_get_file: 'file_read',
    github_search_code: 'file_read',
    github_search_issues: 'file_read',
    github_create_issue: 'shell_exec',
    github_draft_issue: 'shell_exec',
    github_comment: 'shell_exec',
    github_create_pull: 'shell_exec',
    gitlab_whoami: 'file_read',
    gitlab_list_projects: 'file_read',
    gitlab_get_project: 'file_read',
    gitlab_list_issues: 'file_read',
    gitlab_get_issue: 'file_read',
    gitlab_list_merge_requests: 'file_read',
    gitlab_get_merge_request: 'file_read',
    gitlab_list_commits: 'file_read',
    gitlab_get_file: 'file_read',
    gitlab_search: 'file_read',
    gitlab_create_issue: 'shell_exec',
    gitlab_comment: 'shell_exec',
    gitlab_create_merge_request: 'shell_exec',
    codecommit_whoami: 'file_read',
    codecommit_list_repos: 'file_read',
    codecommit_get_repo: 'file_read',
    codecommit_list_branches: 'file_read',
    codecommit_get_branch: 'file_read',
    codecommit_list_commits: 'file_read',
    codecommit_get_file: 'file_read'
  }
  return map[callName] || 'file_read'
}

export async function checkPermission(
  callName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  projectPath?: string,
  opts?: { sessionId?: string; cwd?: string }
): Promise<boolean> {
  const { permissionMode: mode } = useProviderStore.getState()
  const agentMode = useProviderStore.getState().agentModeFor(opts?.sessionId)

  // Plan mode hard-blocks mutating tools before YOLO/hooks can approve them.
  if (!isToolAllowedInAgentMode(callName, agentMode)) {
    return false
  }

  const type = permissionTypeFor(callName)

  const pathArg =
    typeof args.path === 'string'
      ? resolveToolPath(args.path, projectPath)
      : undefined
  const command = typeof args.command === 'string' ? args.command : undefined

  // PermissionRequest hooks can allow/deny before the UI (and even in YOLO).
  // Deny always wins over YOLO / auto / session rules.
  if (!signal?.aborted) {
    const hookRes = await fireHook({
      event: 'PermissionRequest',
      sessionId: opts?.sessionId,
      projectPath: projectPath || null,
      cwd: opts?.cwd || projectPath || undefined,
      payload: {
        tool_name: callName,
        tool_input: args,
        permission_mode: mode
      }
    })
    if (hookRes.decision === 'deny') return false
    if (hookRes.decision === 'allow') return true
  }

  const hidden = typeof document !== 'undefined' && document.hidden === true

  // Optional decision-model risk check for shell commands. It can only turn
  // an automatic approval into a prompt — never skip one — and it is skipped
  // when no dialog can be shown (hidden window: behaviour stays as before).
  const riskEligible = type === 'shell_exec' && !!command?.trim() && !hidden && decisionFeatureOn('shellRiskGuard')
  let riskPromise: Promise<ShellRisk | null> | null = null
  const rateCommand = (): Promise<ShellRisk | null> => {
    if (!riskPromise) riskPromise = assessShellRisk(command!, opts?.cwd || projectPath).catch(() => null)
    return riskPromise
  }
  let escalated: ShellRisk | null = null
  const wouldAutoApprove = async (): Promise<boolean> => {
    if (!riskEligible) return true
    const risk = await rateCommand()
    if (signal?.aborted) return false
    if (risk?.escalate) {
      escalated = risk
      return false
    }
    return true
  }

  if (mode === 'yolo' && (await wouldAutoApprove())) return true
  if (signal?.aborted) return false

  if (!escalated) {
    if (autoApproves(callName, mode, hidden)) return true
    // Hidden window in ask mode cannot show a dialog; refuse anything not auto-approvable.
    if (hidden && mode === 'ask') return false

    const ruleOk =
      usePermissionStore.getState().isAllowedByRules(type, { path: pathArg, command }) ||
      (mode === 'ask' && usePermissionStore.getState().sessionApproved.has(type))
    if (ruleOk && (await wouldAutoApprove())) return true
    if (signal?.aborted) return false
  }

  const typeLabels: Record<string, string> = {
    read_file: 'Read File',
    write_file: 'Write File',
    edit_file: 'Edit File',
    apply_patch: 'Apply Patch',
    shell_wait: 'Wait for Background Job',
    read_output: 'Read Saved Output',
    working_notes: 'Working Notes',
    checkpoint_mark: 'Mark Checkpoint',
    checkpoint_restore: 'Restore Checkpoint',
    project_profile: 'Repo Profile',
    semantic_search: 'Semantic Code Search',
    affected_tests: 'Find Affected Tests',
    lsp_hover: 'Symbol Info',
    lsp_symbols: 'Symbols',
    lsp_call_hierarchy: 'Call Hierarchy',
    lsp_rename: 'Rename Symbol',
    lsp_code_actions: 'Code Actions',
    lsp_apply_code_action: 'Apply Code Action',
    debug_start: 'Start Debugger',
    debug_breakpoints: 'Set Breakpoints',
    debug_control: 'Debugger Step/Continue',
    debug_eval: 'Evaluate in Debugger',
    debug_stop: 'Stop Debugger',
    browser_console: 'Browser Console',
    browser_network: 'Browser Network',
    delete_file: 'Delete File',
    list_dir: 'List Directory',
    shell_exec: 'Shell Command',
    shell_poll: 'Poll Shell Job',
    shell_kill: 'Kill Shell Job',
    git_status: 'Git Status',
    git_diff: 'Git Diff',
    git_log: 'Git Log',
    git_pr_ready: 'Git PR Ready',
    run_checks: 'Run Project Checks',
    codebase_search: 'Codebase Search',
    write_artifact: 'Write Artifact',
    list_artifacts: 'List Artifacts',
    terminal_list: 'List Terminals',
    terminal_read: 'Read Terminal',
    web_search: 'Web Search',
    web_fetch: 'Fetch Public Web Page',
    web_research: 'Web Research',
    research_report: 'Research & Report',
    memory_search: 'Search Memory',
    memory_list: 'List Memory',
    memory_save: 'Save Memory',
    memory_forget: 'Forget Memory',
    memory_update: 'Update Memory',
    decide: 'Ask Decision Model',
    save_skill: 'Save Skill',
    update_plan: 'Update Plan',
    computer_screenshot: 'Take Screenshot',
    computer_zoom: 'Zoom Screen',
    computer_displays: 'List Displays',
    computer_status: 'Computer Status',
    computer_click: 'Mouse Click',
    computer_mouse: 'Mouse',
    computer_drag: 'Mouse Drag',
    computer_scroll: 'Scroll',
    computer_type: 'Type Text',
    computer_key: 'Press Key',
    computer_hold_key: 'Hold Key',
    computer_ui_snapshot: 'Read App UI',
    computer_ui_action: 'Operate UI Element',
    computer_find: 'Find on Screen',
    computer_ocr: 'Read Screen Text',
    computer_apps: 'Manage Apps',
    computer_windows: 'Manage Windows',
    computer_menu: 'App Menu',
    computer_open: 'Open File/URL',
    computer_clipboard: 'Clipboard',
    computer_wait: 'Wait',
    browser_navigate: 'Navigate Browser',
    browser_snapshot: 'Read Page Elements',
    browser_read_text: 'Read Page Text',
    browser_screenshot: 'Take Page Screenshot',
    browser_back: 'Browser Back',
    browser_wait: 'Wait in Browser',
    browser_scroll: 'Scroll Browser',
    browser_click: 'Click in Browser',
    browser_fill: 'Type in Browser',
    browser_select: 'Select Option',
    browser_eval: 'Evaluate JS in Page',
    browser_open_external: 'Open External Browser',
    browser_tab_new: 'Open Browser Tab',
    browser_tab_list: 'List Browser Tabs',
    browser_tab_switch: 'Switch Browser Tab',
    browser_tab_close: 'Close Browser Tab',
    load_skill: 'Load Skill',
    install_skill: 'Install Skill',
    search_files: 'Search Files',
    grep_search: 'Search Text',
    app_open_tab: 'Open App Tab',
    app_close_tab: 'Close App Tab',
    app_list_automations: 'List Automations',
    app_create_automation: 'Create Automation',
    app_set_model: 'Change Model',
    app_set_permission_mode: 'Change Permission Mode',
    app_set_agent_mode: 'Change Agent Mode',
    app_set_reasoning: 'Change Reasoning Effort',
    app_toggle_theme: 'Toggle Theme',
    repo_map: 'Repository Map',
    issue_to_pr: 'Issue→PR Playbook'
  }

  const mcpMatch = callName.startsWith('mcp__') ? callName.slice(5).match(/^(.+?)__(.+)$/) : null
  const description = mcpMatch ? `${mcpMatch[1]}: ${mcpMatch[2]}` : (typeLabels[callName] || callName)

  // Show the rating on the prompt: immediately when already known, otherwise
  // the dialog opens right away and the rating lands when it arrives.
  const escalatedRisk = escalated as ShellRisk | null
  const riskKey = riskEligible ? `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined
  if (riskKey && !escalatedRisk) {
    void rateCommand().then((r) => usePermissionStore.getState().annotateRisk(riskKey, r ? toPermissionRisk(r, false) : null))
  }

  const approved = await usePermissionStore.getState().request(
    {
      type,
      description,
      details: JSON.stringify(args, null, 2).slice(0, 500),
      preview: buildPermissionPreview(callName, args, { path: pathArg }),
      path: pathArg,
      command,
      sessionId: opts?.sessionId,
      ...(escalatedRisk ? { risk: toPermissionRisk(escalatedRisk, true) } : {}),
      ...(riskKey && !escalatedRisk ? { riskKey, riskPending: true } : {})
    },
    signal
  )
  return approved
}

function toPermissionRisk(r: ShellRisk, escalated: boolean): PermissionRisk {
  return { level: r.level, probability: r.probabilities[r.level] ?? 0, sendsData: r.sendsData, escalated, model: r.model }
}
