import { handleTrusted } from './trust'
import {
  cancelConnect,
  connectProvider,
  connectWithPat,
  disconnectProvider,
  getConnectionStatus,
  listConnectionStatuses,
  isConnectionProvider,
  isPatProvider,
  type ConnectionProvider,
  type PatCredentials
} from '../connections'
import { beginConnectSession } from '../connections/session'
import { runGoogleTool, type GoogleToolName } from '../connections/googleTools'
import { runGithubTool, type GithubToolName } from '../connections/githubTools'
import { runGitlabTool, type GitlabToolName } from '../connections/gitlabTools'
import { runCodeCommitTool, type CodeCommitToolName } from '../connections/codecommitTools'

const GOOGLE_TOOLS = new Set<string>([
  'google_whoami',
  'google_drive_search',
  'google_drive_read',
  'google_gmail_search',
  'google_gmail_read',
  'google_gmail_send',
  'google_calendar_list',
  'google_calendar_create',
  'google_tasks_list',
  'google_sheets_read',
  'google_sheets_write',
  'google_docs_read',
  'google_slides_read'
])

const GITHUB_TOOLS = new Set<string>([
  'github_whoami',
  'github_list_repos',
  'github_get_repo',
  'github_list_issues',
  'github_get_issue',
  'github_list_pulls',
  'github_get_pull',
  'github_review_pull',
  'github_list_commits',
  'github_get_file',
  'github_search_code',
  'github_search_issues',
  'github_create_issue',
  'github_draft_issue',
  'github_comment',
  'github_create_pull'
])

const GITLAB_TOOLS = new Set<string>([
  'gitlab_whoami',
  'gitlab_list_projects',
  'gitlab_get_project',
  'gitlab_list_issues',
  'gitlab_get_issue',
  'gitlab_list_merge_requests',
  'gitlab_get_merge_request',
  'gitlab_list_commits',
  'gitlab_get_file',
  'gitlab_search',
  'gitlab_create_issue',
  'gitlab_comment',
  'gitlab_create_merge_request'
])

const CODECOMMIT_TOOLS = new Set<string>([
  'codecommit_whoami',
  'codecommit_list_repos',
  'codecommit_get_repo',
  'codecommit_list_branches',
  'codecommit_get_branch',
  'codecommit_list_commits',
  'codecommit_get_file'
])

export function registerConnectionsIpc(): void {
  handleTrusted('connections:list', async () => listConnectionStatuses())

  handleTrusted('connections:status', async (_, provider: string) => {
    if (!isConnectionProvider(provider)) return { error: 'Unknown provider' }
    return getConnectionStatus(provider)
  })

  handleTrusted('connections:connect', async (event, provider: string) => {
    if (!isConnectionProvider(provider)) {
      return { error: 'Unknown provider' }
    }
    if (isPatProvider(provider)) {
      return {
        error: `${provider} requires PAT credentials. Use connections:connectPat.`
      }
    }
    const signal = beginConnectSession(provider)
    return connectProvider(provider, {
      signal,
      onProgress: (p) => {
        try {
          event.sender.send('connections:progress', { provider, ...p })
        } catch { /* window gone */ }
      }
    })
  })

  handleTrusted(
    'connections:connectPat',
    async (_, provider: string, credentials: PatCredentials = {}) => {
      if (!isPatProvider(provider)) {
        return { error: 'Provider does not support PAT authentication' }
      }
      if (!credentials || typeof credentials !== 'object') {
        return { error: 'Credentials object required' }
      }
      return connectWithPat(provider, credentials)
    }
  )

  handleTrusted('connections:cancel', async (_, provider: string) => {
    if (!isConnectionProvider(provider)) {
      return { error: 'Unknown provider' }
    }
    cancelConnect(provider as ConnectionProvider)
    return { ok: true }
  })

  handleTrusted('connections:disconnect', async (_, provider: string) => {
    if (!isConnectionProvider(provider)) {
      return { error: 'Unknown provider' }
    }
    cancelConnect(provider)
    disconnectProvider(provider)
    return { ok: true }
  })

  /** Agent tools — main process holds tokens; never return secrets. */
  handleTrusted(
    'connections:runTool',
    async (_, name: string, args: Record<string, unknown> = {}) => {
      if (typeof name !== 'string' || !name) {
        return { ok: false, error: 'Tool name required' }
      }
      try {
        if (GOOGLE_TOOLS.has(name)) {
          const res = await runGoogleTool(name as GoogleToolName, args || {})
          return res.ok
            ? { ok: true, text: res.text }
            : { ok: false, error: res.error || res.text || 'Google tool failed', text: res.text }
        }
        if (GITHUB_TOOLS.has(name)) {
          const res = await runGithubTool(name as GithubToolName, args || {})
          return res.ok
            ? { ok: true, text: res.text }
            : { ok: false, error: res.error || res.text || 'GitHub tool failed', text: res.text }
        }
        if (GITLAB_TOOLS.has(name)) {
          const res = await runGitlabTool(name as GitlabToolName, args || {})
          return res.ok
            ? { ok: true, text: res.text }
            : { ok: false, error: res.error || res.text || 'GitLab tool failed', text: res.text }
        }
        if (CODECOMMIT_TOOLS.has(name)) {
          const res = await runCodeCommitTool(name as CodeCommitToolName, args || {})
          return res.ok
            ? { ok: true, text: res.text }
            : { ok: false, error: res.error || res.text || 'CodeCommit tool failed', text: res.text }
        }
        return { ok: false, error: `Unknown connection tool: ${name}` }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
