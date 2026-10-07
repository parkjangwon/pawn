import { tx } from '../i18n'

/**
 * Human labels (and icons) for tool calls, shared by single tool rows and the
 * batched "Executed N operations" header. Tools without an entry get a
 * readable fallback ("web_search" → "Web search") instead of the raw id.
 */
export interface ToolLabel {
  icon: string
  label: string
}

export function toolLabelTable(): Record<string, ToolLabel> {
  return {
    read_file: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', label: 'Read file' },
    write_file: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', label: 'Write file' },
    edit_file: { icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', label: 'Edit file' },
    delete_file: { icon: 'M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2', label: 'Delete' },
    list_dir: { icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', label: 'List directory' },
    shell_exec: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Run command' },
    shell_poll: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Shell poll' },
    shell_kill: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Shell kill' },
    git_status: { icon: 'M6 3v12M18 9a3 3 0 11-6 0 3 3 0 016 0zM6 15a3 3 0 100 6 3 3 0 000-6z', label: 'Git status' },
    git_diff: { icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6', label: 'Git diff' },
    git_log: { icon: 'M12 8v4l3 3', label: 'Git log' },
    git_add: { icon: 'M12 5v14M5 12h14', label: 'git add' },
    git_commit: { icon: 'M12 8v4l3 3', label: 'git commit' },
    git_push: { icon: 'M12 19V5M5 12l7-7 7 7', label: 'git push' },
    git_branch: { icon: 'M6 3v12M18 9a3 3 0 11-6 0 3 3 0 016 0z', label: 'git branch' },
    git_stash: { icon: 'M21 8v13H3V8M1 3h22v5H1z', label: 'git stash' },
    spawn_agent: { icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', label: 'Subagent' },
    parallel_agents: { icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', label: 'Parallel agents' },
    list_agents: { icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', label: 'List agents' },
    await_agent: { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Await agent' },
    cancel_agent: { icon: 'M18 6L6 18M6 6l12 12', label: 'Cancel agent' },
    update_plan: { icon: 'M9 11l3 3L22 4', label: 'Plan' },
    computer_screenshot: { icon: 'M11 4a2 2 0 118 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z', label: 'Take screenshot' },
    computer_displays: { icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', label: 'Displays' },
    computer_click: { icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', label: 'Click element' },
    computer_move: { icon: 'M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122', label: 'Move' },
    computer_drag: { icon: 'M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11', label: 'Drag' },
    computer_scroll: { icon: 'M19 13l-7 7-7-7m14-8l-7 7-7-7', label: 'Scroll' },
    computer_type: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Type text' },
    computer_keypress: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Keypress' },
    computer_key: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Keypress' },
    str_replace_based_edit_tool: { icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', label: 'Edit file' },
    apply_patch: { icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', label: 'Apply patch' },
    bash: { icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Run command' },
    shell_wait: { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Await job' },
    read_output: { icon: 'M4 6h16M4 12h16M4 18h10', label: 'Saved output' },
    working_notes: { icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Working notes' },
    checkpoint_mark: { icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z', label: 'Checkpoint' },
    checkpoint_restore: { icon: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6', label: 'Restore checkpoint' },
    project_profile: { icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Repo profile' },
    semantic_search: { icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', label: 'Search' },
    affected_tests: { icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Affected tests' },
    debug_start: { icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Debugger' },
    debug_breakpoints: { icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Debugger' },
    debug_control: { icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z', label: 'Debugger' },
    debug_eval: { icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Debugger' },
    debug_stop: { icon: 'M6 6h12v12H6z', label: 'Debugger' },
    browser_console: { icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Page console' },
    browser_network: { icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9', label: 'Page network' },
    second_opinion: { icon: 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-1m10-9V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l4-4h2', label: 'Second opinion' },
    computer_hold_key: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Keypress' },
    computer_mouse: { icon: 'M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5', label: 'Move' },
    computer_zoom: { icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7', label: 'Zoom' },
    computer_ui_snapshot: { icon: 'M4 6h16M4 12h10M4 18h7', label: 'Read UI' },
    computer_ui_action: { icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', label: 'Click element' },
    computer_find: { icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', label: 'Find screen' },
    computer_ocr: { icon: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 12h8', label: 'Read text' },
    computer_apps: { icon: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z', label: 'Apps' },
    computer_windows: { icon: 'M3 5h18v14H3zM3 9h18', label: 'Windows' },
    computer_menu: { icon: 'M4 6h16M4 12h16M4 18h16', label: 'Menu' },
    computer_open: { icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', label: 'Open' },
    computer_status: { icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Computer status' },
    computer_clipboard: { icon: 'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3', label: 'Clipboard' },
    computer_wait: { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Wait' },
    browser_open: { icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', label: 'Browse page' }
  }
}

/** "web_search" → "Web search"; "mcp__github__list_issues" → "github: list issues". */
export function humanizeToolName(name: string): string {
  const mcp = name.startsWith('mcp__') ? name.slice(5).match(/^(.+?)__(.+)$/) : null
  const words = (mcp ? mcp[2] : name).replace(/_/g, ' ').trim()
  const nice = words.charAt(0).toUpperCase() + words.slice(1)
  return mcp ? `${mcp[1]}: ${nice.charAt(0).toLowerCase()}${nice.slice(1)}` : nice
}

const ICON = {
  globe: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  table: 'M3 10h18M3 14h18M10 3v18M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  brain: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  branch: 'M6 3v12M18 9a3 3 0 11-6 0 3 3 0 016 0zM6 15a3 3 0 100 6 3 3 0 000-6z',
  ask: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
}

/**
 * Tool families by prefix → a readable action ("Browser", "Google Sheets",
 * "Memory"…), so the ~100 long-tail tools never show a raw id.
 */
function familyLabel(name: string): ToolLabel | undefined {
  const f = (key: string, icon: string): ToolLabel => ({ icon, label: tx(`toolMessage.family.${key}`) })
  if (name === 'web_search' || name === 'web_research' || name === 'research_report') return f('webSearch', ICON.search)
  if (name === 'web_fetch') return f('webRead', ICON.globe)
  if (name.startsWith('browser_')) return f('browser', ICON.globe)
  if (name === 'read_spreadsheet' || name.startsWith('google_sheets')) return f('spreadsheet', ICON.table)
  if (name.startsWith('google_gmail')) return f('email', ICON.mail)
  if (name.startsWith('google_calendar') || name.startsWith('google_tasks')) return f('calendar', ICON.calendar)
  if (name.startsWith('google_')) return f('google', ICON.doc)
  if (name.startsWith('github_') || name.startsWith('gitlab_') || name.startsWith('codecommit_') || name === 'git_pr_ready' || name === 'issue_to_pr') return f('repoHost', ICON.branch)
  if (name.startsWith('wiki_')) return f('wiki', ICON.brain)
  if (name === 'write_artifact' || name === 'list_artifacts') return f('document', ICON.doc)
  if (name.startsWith('lsp_') || name === 'repo_map' || name === 'codebase_search') return f('codeIntel', ICON.code)
  if (name === 'grep_search' || name === 'search_files') return f('findFiles', ICON.search)
  if (name === 'ask_user' || name === 'request_plan_approval') return f('question', ICON.ask)
  if (name === 'run_checks') return f('checks', ICON.check)
  if (name.startsWith('app_') || name === 'load_skill' || name === 'install_skill' || name === 'load_tools') return f('app', ICON.gear)
  if (name.startsWith('terminal_')) return f('terminal', 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z')
  return undefined
}

export function toolLabel(name: string, table = toolLabelTable()): ToolLabel {
  return table[name] || familyLabel(name) || { icon: '', label: humanizeToolName(name) }
}
