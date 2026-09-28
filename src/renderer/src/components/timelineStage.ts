/** Agent-timeline stage. Pastels stay on these rows — never on buttons or status chrome. */
export type TimelineStage = 'thinking' | 'grep' | 'read' | 'edit'

const GREP = /search|grep|codebase|semantic|affected_test|repo_map/
const EDIT =
  /write|edit|delete|shell_exec|shell_kill|git_add|git_commit|git_push|git_branch|git_stash|apply|debug_|browser_click|browser_fill|browser_select|browser_eval|browser_navigate|browser_tab_new|browser_tab_switch|browser_tab_close|computer_click|computer_type|computer_key|computer_drag|computer_scroll|computer_mouse|computer_hold|computer_ui_action|computer_menu|computer_open|computer_clipboard|save_skill|install_skill|checkpoint|memory_save|memory_update|memory_forget|memory_consolidate|lsp_rename|lsp_apply/

/**
 * Map a tool name onto the five-stage timeline.
 * "Done" is a status pill, not a tool kind, so it is not returned here.
 */
export function timelineStage(name: string): TimelineStage {
  const n = name.toLowerCase()
  if (GREP.test(n)) return 'grep'
  if (EDIT.test(n)) return 'edit'
  if (
    /^(read_|list_|lsp_|git_status|git_diff|git_log|git_pr|memory_search|memory_list|browser_|computer_screenshot|computer_zoom|computer_ocr|computer_find|computer_ui_snapshot|computer_status|computer_displays|computer_apps|computer_windows|terminal_|web_fetch|shell_poll|shell_wait)/.test(
      n
    )
  ) {
    return 'read'
  }
  return 'thinking'
}
