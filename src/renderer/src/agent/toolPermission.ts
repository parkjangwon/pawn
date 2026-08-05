import { useProviderStore } from '../stores/provider'
import { usePermissionStore, type PermissionType } from '../stores/permission'
import { resolveToolPath } from './pathUtils'

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
  update_plan: 'safe',
  shell_poll: 'safe',
  browser_navigate: 'safe',
  browser_snapshot: 'safe',
  browser_read_text: 'safe',
  browser_screenshot: 'safe',
  browser_back: 'safe',
  install_skill: 'risky',
  browser_open_external: 'risky',
  browser_click: 'risky',
  browser_fill: 'risky',
  browser_eval: 'risky',
  write_file: 'risky',
  edit_file: 'risky',
  delete_file: 'risky',
  shell_exec: 'risky',
  shell_kill: 'risky',
  computer_screenshot: 'risky',
  computer_click: 'risky',
  computer_type: 'risky',
  computer_keypress: 'risky',
  app_open_tab: 'safe',
  app_close_tab: 'safe',
  app_list_automations: 'safe',
  app_create_automation: 'risky',
  app_set_model: 'safe',
  app_set_reasoning: 'safe',
  app_toggle_theme: 'safe',
  app_set_permission_mode: 'risky',
  // Google (read-only)
  google_whoami: 'safe',
  google_drive_search: 'safe',
  google_drive_read: 'safe',
  google_gmail_search: 'safe',
  google_gmail_read: 'safe',
  google_calendar_list: 'safe',
  google_tasks_list: 'safe',
  google_sheets_read: 'safe',
  google_docs_read: 'safe',
  google_slides_read: 'safe',
  // GitHub
  github_whoami: 'safe',
  github_list_repos: 'safe',
  github_get_repo: 'safe',
  github_list_issues: 'safe',
  github_get_issue: 'safe',
  github_list_pulls: 'safe',
  github_get_pull: 'safe',
  github_list_commits: 'safe',
  github_get_file: 'safe',
  github_search_code: 'safe',
  github_search_issues: 'safe',
  github_create_issue: 'risky',
  github_comment: 'risky',
  github_create_pull: 'risky'
}

export type PermissionMode = 'ask' | 'auto' | 'yolo'

function permissionTypeFor(callName: string): PermissionType {
  if (callName.startsWith('mcp__')) return 'mcp'
  const map: Record<string, PermissionType> = {
    computer_screenshot: 'computer_use',
    computer_click: 'computer_use',
    computer_type: 'computer_use',
    computer_keypress: 'computer_use',
    browser_eval: 'browser',
    browser_click: 'browser',
    browser_fill: 'browser',
    browser_open_external: 'browser',
    shell_exec: 'shell_exec',
    shell_kill: 'shell_exec',
    write_file: 'file_write',
    edit_file: 'file_write',
    delete_file: 'file_write',
    git_status: 'file_read',
    git_diff: 'file_read',
    git_log: 'file_read',
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
    github_list_commits: 'file_read',
    github_get_file: 'file_read',
    github_search_code: 'file_read',
    github_search_issues: 'file_read',
    github_create_issue: 'shell_exec',
    github_comment: 'shell_exec',
    github_create_pull: 'shell_exec'
  }
  return map[callName] || 'file_read'
}

export async function checkPermission(
  callName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  projectPath?: string
): Promise<boolean> {
  const mode = useProviderStore.getState().permissionMode
  if (mode === 'yolo') return true

  const hidden = typeof document !== 'undefined' && document.hidden === true
  if (hidden && mode === 'ask') {
    const safety = TOOL_SAFETY[callName] || 'risky'
    return safety === 'safe'
  }

  const safety = TOOL_SAFETY[callName] || 'risky'
  if (mode === 'auto' && safety === 'safe') return true

  const type = permissionTypeFor(callName)

  const pathArg =
    typeof args.path === 'string'
      ? resolveToolPath(args.path, projectPath)
      : undefined
  const command = typeof args.command === 'string' ? args.command : undefined

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
    update_plan: 'Update Plan',
    computer_screenshot: 'Take Screenshot',
    computer_click: 'Mouse Click',
    computer_type: 'Type Text',
    computer_keypress: 'Press Key',
    browser_navigate: 'Navigate Browser',
    browser_snapshot: 'Read Page Elements',
    browser_read_text: 'Read Page Text',
    browser_screenshot: 'Take Page Screenshot',
    browser_back: 'Browser Back',
    browser_click: 'Click in Browser',
    browser_fill: 'Type in Browser',
    browser_eval: 'Evaluate JS in Page',
    browser_open_external: 'Open External Browser',
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
    app_set_reasoning: 'Change Reasoning Effort',
    app_toggle_theme: 'Toggle Theme'
  }

  const mcpMatch = callName.startsWith('mcp__') ? callName.slice(5).match(/^(.+?)__(.+)$/) : null
  const description = mcpMatch ? `${mcpMatch[1]}: ${mcpMatch[2]}` : (typeLabels[callName] || callName)

  const approved = await usePermissionStore.getState().request(
    {
      type,
      description,
      details: JSON.stringify(args, null, 2).slice(0, 500),
      path: pathArg,
      command
    },
    signal
  )
  return approved
}
