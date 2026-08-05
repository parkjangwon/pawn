import {
  clearTokens,
  getGithubClientId,
  getGoogleClientId,
  loadTokens
} from './store'
import { connectGoogle, disconnectGoogle, getGoogleAccessToken } from './google'
import { connectGithub, disconnectGithub, getGithubAccessToken } from './github'
import { connectGitlab, disconnectGitlab, getGitlabAccessToken } from './gitlab'
import { connectCodeCommit, disconnectCodeCommit } from './codecommit'
import { beginConnectSession, cancelConnect, endConnectSession, type ConnectHooks } from './session'
import type {
  ConnectionProvider,
  ConnectionStatus,
  PatCredentials,
  PatProvider
} from './types'
import { ALL_CONNECTION_PROVIDERS, isPatProvider } from './types'

export type { ConnectionProvider, ConnectionStatus, PatCredentials, PatProvider }
export type { ConnectProgress } from './session'
export { getGoogleAccessToken, getGithubAccessToken, getGitlabAccessToken, cancelConnect }
export { isPatProvider, isConnectionProvider, ALL_CONNECTION_PROVIDERS, PAT_PROVIDERS } from './types'

export function getConnectionStatus(provider: ConnectionProvider): ConnectionStatus {
  const tokens = loadTokens(provider)
  const isPat = isPatProvider(provider)
  const clientConfigured = isPat
    ? true
    : provider === 'google'
      ? !!getGoogleClientId()
      : !!getGithubClientId()

  let hostHint: string | undefined
  if (provider === 'gitlab' && tokens?.baseUrl) {
    try {
      hostHint = new URL(tokens.baseUrl).host
    } catch {
      hostHint = tokens.baseUrl
    }
  } else if (provider === 'codecommit' && tokens?.region) {
    hostHint = tokens.region
  }

  return {
    provider,
    connected: !!tokens?.accessToken,
    accountLabel: tokens?.accountLabel,
    scope: tokens?.scope,
    clientConfigured,
    authMode: isPat ? 'pat' : 'oauth',
    updatedAt: tokens?.updatedAt,
    hostHint
  }
}

export function listConnectionStatuses(): ConnectionStatus[] {
  return ALL_CONNECTION_PROVIDERS.map(getConnectionStatus)
}

export async function connectProvider(
  provider: ConnectionProvider,
  hooks: ConnectHooks = {}
): Promise<{
  ok?: boolean
  error?: string
  accountLabel?: string
  userCode?: string
  verificationUri?: string
  cancelled?: boolean
}> {
  if (isPatProvider(provider)) {
    return {
      error: `${provider} uses PAT credentials. Call connectWithPat with token fields instead of OAuth connect.`
    }
  }
  const signal = hooks.signal || beginConnectSession(provider)
  const full: ConnectHooks = { ...hooks, signal }
  try {
    if (provider === 'google') return await connectGoogle(undefined, full)
    return await connectGithub(full)
  } finally {
    endConnectSession(provider)
  }
}

export async function connectWithPat(
  provider: PatProvider,
  credentials: PatCredentials
): Promise<{ ok?: boolean; error?: string; accountLabel?: string }> {
  if (provider === 'gitlab') return connectGitlab(credentials)
  if (provider === 'codecommit') return connectCodeCommit(credentials)
  return { error: 'Unknown PAT provider' }
}

export function disconnectProvider(provider: ConnectionProvider): void {
  if (provider === 'google') disconnectGoogle()
  else if (provider === 'github') disconnectGithub()
  else if (provider === 'gitlab') disconnectGitlab()
  else if (provider === 'codecommit') disconnectCodeCommit()
}

/** For agent tools — never throw secrets. */
export async function githubApi(path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const token = getGithubAccessToken()
  if (!token) return { ok: false, status: 401, body: { error: 'GitHub not connected' } }
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Pawn-Desktop'
    }
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function googleApi(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const token = await getGoogleAccessToken()
  if (!token) return { ok: false, status: 401, body: { error: 'Google not connected' } }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export function wipeAllConnections(): void {
  clearTokens('google')
  clearTokens('github')
  clearTokens('gitlab')
  clearTokens('codecommit')
}
