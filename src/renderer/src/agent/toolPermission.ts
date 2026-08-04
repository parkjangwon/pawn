import { useProviderStore } from '../stores/provider'
import { usePermissionStore, type PermissionType } from '../stores/permission'

export type SafetyLevel = 'safe' | 'risky'

export const TOOL_SAFETY: Record<string, SafetyLevel> = {
  read_file: 'safe',
  list_dir: 'safe',
  load_skill: 'safe',
  search_files: 'safe',
  grep_search: 'safe',
  git_status: 'safe',
  git_diff: 'safe',
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
  // Escalating permissions (auto -> yolo) deserves an explicit confirmation.
  app_set_permission_mode: 'risky'
}

// Permission mode
export type PermissionMode = 'ask' | 'auto' | 'yolo'

export async function checkPermission(
  callName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<boolean> {
  const mode = useProviderStore.getState().permissionMode
  if (mode === 'yolo') return true

  // A hidden window (headless routine runs) can never show a permission
  // dialog. 'ask' degrades to 'auto' semantics there: safe tools pass,
  // risky tools are denied outright instead of hanging the run.
  const hidden = typeof document !== 'undefined' && document.hidden === true
  if (hidden && mode === 'ask') {
    const safety = TOOL_SAFETY[callName] || 'risky'
    return safety === 'safe'
  }

  const safety = TOOL_SAFETY[callName] || 'risky'
  if (mode === 'auto' && safety === 'safe') return true

  const type = (() => {
    if (callName.startsWith('mcp__')) return 'mcp' as PermissionType
    const map: Record<string, string> = {
      computer_screenshot: 'computer_use', computer_click: 'computer_use', computer_type: 'computer_use', computer_keypress: 'computer_use',
      browser_eval: 'browser', browser_click: 'browser', browser_fill: 'browser', browser_open_external: 'browser',
      shell_exec: 'shell_exec',
      write_file: 'file_write', edit_file: 'file_write', delete_file: 'file_write',
      git_status: 'file_read', git_diff: 'file_read',
      app_open_tab: 'app', app_close_tab: 'app', app_list_automations: 'app', app_create_automation: 'app', app_set_model: 'app',
      app_set_permission_mode: 'app', app_set_reasoning: 'app', app_toggle_theme: 'app', install_skill: 'app'
    }
    return (map[callName] || 'file_read') as PermissionType
  })()

  // The user clicked "Allow for this session" on this type earlier; skip the
  // dialog until the app restarts.
  if (mode === 'ask' && usePermissionStore.getState().sessionApproved.has(type)) return true

  const typeLabels: Record<string, string> = {
    read_file: 'Read File',
    write_file: 'Write File',
    edit_file: 'Edit File',
    delete_file: 'Delete File',
    list_dir: 'List Directory',
    shell_exec: 'Shell Command',
    git_status: 'Git Status',
    git_diff: 'Git Diff',
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

  // mcp__<server>__<tool> reads better as "server: tool" than the raw name.
  const mcpMatch = callName.startsWith('mcp__') ? callName.slice(5).match(/^(.+?)__(.+)$/) : null
  const description = mcpMatch ? `${mcpMatch[1]}: ${mcpMatch[2]}` : (typeLabels[callName] || callName)

  const approved = await usePermissionStore.getState().request(
    {
      type,
      description,
      details: JSON.stringify(args, null, 2).slice(0, 500)
    },
    signal
  )
  return approved
}
