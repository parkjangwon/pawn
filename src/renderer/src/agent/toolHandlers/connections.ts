import type { ToolHandler } from './types'


const google_whoami: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.connections?.runTool) {
          return {
            toolCallId: call.id,
            content: 'Service connections are only available in the desktop app.',
            isError: true
          }
        }
        const res = await api.connections.runTool(call.name, call.arguments || {})
        if (!res?.ok) {
          return {
            toolCallId: call.id,
            content: res?.error || res?.text || `${call.name} failed`,
            isError: true
          }
        }
        return { toolCallId: call.id, content: res.text || '(empty)' }
      }


export const connectionsHandlers: Record<string, ToolHandler> = {
  'google_whoami': google_whoami,
  'google_drive_search': google_whoami,
  'google_drive_read': google_whoami,
  'google_gmail_search': google_whoami,
  'google_gmail_read': google_whoami,
  'google_calendar_list': google_whoami,
  'google_tasks_list': google_whoami,
  'google_sheets_read': google_whoami,
  'google_docs_read': google_whoami,
  'google_slides_read': google_whoami,
  'github_whoami': google_whoami,
  'github_list_repos': google_whoami,
  'github_get_repo': google_whoami,
  'github_list_issues': google_whoami,
  'github_get_issue': google_whoami,
  'github_list_pulls': google_whoami,
  'github_get_pull': google_whoami,
  'github_review_pull': google_whoami,
  'github_list_commits': google_whoami,
  'github_get_file': google_whoami,
  'github_search_code': google_whoami,
  'github_search_issues': google_whoami,
  'github_create_issue': google_whoami,
  'github_draft_issue': google_whoami,
  'github_comment': google_whoami,
  'github_create_pull': google_whoami,
  'gitlab_whoami': google_whoami,
  'gitlab_list_projects': google_whoami,
  'gitlab_get_project': google_whoami,
  'gitlab_list_issues': google_whoami,
  'gitlab_get_issue': google_whoami,
  'gitlab_list_merge_requests': google_whoami,
  'gitlab_get_merge_request': google_whoami,
  'gitlab_list_commits': google_whoami,
  'gitlab_get_file': google_whoami,
  'gitlab_search': google_whoami,
  'gitlab_create_issue': google_whoami,
  'gitlab_comment': google_whoami,
  'gitlab_create_merge_request': google_whoami,
  'codecommit_whoami': google_whoami,
  'codecommit_list_repos': google_whoami,
  'codecommit_get_repo': google_whoami,
  'codecommit_list_branches': google_whoami,
  'codecommit_get_branch': google_whoami,
  'codecommit_list_commits': google_whoami,
  'codecommit_get_file': google_whoami,
}
