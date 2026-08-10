import { useProviderStore } from '../stores/provider'
import { usePermissionStore, type PermissionType } from '../stores/permission'
import { resolveToolPath } from './pathUtils'
import { fireHook } from './hooksClient'
import { isToolAllowedInAgentMode } from './agentMode'

export type SafetyLevel = 'safe' | 'risky'

export const TOOL_SAFETY: Record<string, SafetyLevel> = {
  read_file: 'safe',
  read_spreadsheet: 'safe',
  list_dir: 'safe',
  load_skill: 'safe',
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
  delete_file: 'risky',
  shell_exec: 'risky',
  shell_kill: 'risky',
  computer_screenshot: 'risky',
  computer_displays: 'safe',
  computer_status: 'safe',
  computer_click: 'risky',
  computer_move: 'risky',
  computer_drag: 'risky',
  computer_scroll: 'risky',
  computer_type: 'risky',
  computer_keypress: 'risky',
  computer_clipboard: 'risky',
  computer_wait: 'safe',
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
  const map: Record<string, PermissionType> = {
    computer_screenshot: 'computer_use',
    computer_displays: 'computer_use',
    computer_status: 'computer_use',
    computer_click: 'computer_use',
    computer_move: 'computer_use',
    computer_drag: 'computer_use',
    computer_scroll: 'computer_use',
    computer_type: 'computer_use',
    computer_keypress: 'computer_use',
    computer_clipboard: 'computer_use',
    computer_wait: 'computer_use',
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
    write_file: 'file_write',
    edit_file: 'file_write',
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
    web_fetch: 'file_read',
    web_research: 'file_read',
    memory_search: 'file_read',
    memory_list: 'file_read',
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

  if (mode === 'yolo') return true

  const hidden = typeof document !== 'undefined' && document.hidden === true
  if (hidden && mode === 'ask') {
    const safety = TOOL_SAFETY[callName] || 'risky'
    return safety === 'safe'
  }

  const safety = TOOL_SAFETY[callName] || 'risky'
  if (mode === 'auto' && safety === 'safe') return true

  if (usePermissionStore.getState().isAllowedByRules(type, { path: pathArg, command })) {
    return true
  }

  if (mode === 'ask' && usePermissionStore.getState().sessionApproved.has(type)) return true

  const typeLabels: Record<string, string> = {
    read_file: 'Read File',
    write_file: 'Write File',
    edit_file: 'Edit File',
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
    update_plan: 'Update Plan',
    computer_screenshot: 'Take Screenshot',
    computer_displays: 'List Displays',
    computer_status: 'Computer Status',
    computer_click: 'Mouse Click',
    computer_move: 'Move Mouse',
    computer_drag: 'Mouse Drag',
    computer_scroll: 'Scroll',
    computer_type: 'Type Text',
    computer_keypress: 'Press Key',
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

  const approved = await usePermissionStore.getState().request(
    {
      type,
      description,
      details: JSON.stringify(args, null, 2).slice(0, 500),
      path: pathArg,
      command,
      sessionId: opts?.sessionId
    },
    signal
  )
  return approved
}
