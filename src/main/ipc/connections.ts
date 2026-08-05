import { handleTrusted } from './trust'
import {
  cancelConnect,
  connectProvider,
  disconnectProvider,
  getConnectionStatus,
  listConnectionStatuses,
  type ConnectionProvider
} from '../connections'
import { beginConnectSession } from '../connections/session'
import { runGoogleTool, type GoogleToolName } from '../connections/googleTools'
import { runGithubTool, type GithubToolName } from '../connections/githubTools'

const GOOGLE_TOOLS = new Set<string>([
  'google_whoami',
  'google_drive_search',
  'google_drive_read',
  'google_gmail_search',
  'google_gmail_read',
  'google_calendar_list',
  'google_tasks_list',
  'google_sheets_read',
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
  'github_list_commits',
  'github_get_file',
  'github_search_code',
  'github_search_issues',
  'github_create_issue',
  'github_comment',
  'github_create_pull'
])

export function registerConnectionsIpc(): void {
  handleTrusted('connections:list', async () => listConnectionStatuses())

  handleTrusted('connections:status', async (_, provider: ConnectionProvider) => {
    return getConnectionStatus(provider)
  })

  handleTrusted('connections:connect', async (event, provider: ConnectionProvider) => {
    if (provider !== 'google' && provider !== 'github') {
      return { error: 'Unknown provider' }
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

  handleTrusted('connections:cancel', async (_, provider: ConnectionProvider) => {
    if (provider !== 'google' && provider !== 'github') {
      return { error: 'Unknown provider' }
    }
    cancelConnect(provider)
    return { ok: true }
  })

  handleTrusted('connections:disconnect', async (_, provider: ConnectionProvider) => {
    if (provider !== 'google' && provider !== 'github') {
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
        return { ok: false, error: `Unknown connection tool: ${name}` }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
