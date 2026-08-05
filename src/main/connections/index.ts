import {
  clearTokens,
  getGithubClientId,
  getGoogleClientId,
  loadTokens
} from './store'
import { connectGoogle, disconnectGoogle, getGoogleAccessToken } from './google'
import { connectGithub, disconnectGithub, getGithubAccessToken } from './github'
import { beginConnectSession, cancelConnect, endConnectSession, type ConnectHooks } from './session'
import type { ConnectionProvider, ConnectionStatus } from './types'

export type { ConnectionProvider, ConnectionStatus }
export type { ConnectProgress } from './session'
export { getGoogleAccessToken, getGithubAccessToken, cancelConnect }

export function getConnectionStatus(provider: ConnectionProvider): ConnectionStatus {
  const tokens = loadTokens(provider)
  const clientConfigured =
    provider === 'google' ? !!getGoogleClientId() : !!getGithubClientId()
  return {
    provider,
    connected: !!tokens?.accessToken,
    accountLabel: tokens?.accountLabel,
    scope: tokens?.scope,
    clientConfigured,
    updatedAt: tokens?.updatedAt
  }
}

export function listConnectionStatuses(): ConnectionStatus[] {
  return [getConnectionStatus('google'), getConnectionStatus('github')]
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
  const signal = hooks.signal || beginConnectSession(provider)
  const full: ConnectHooks = { ...hooks, signal }
  try {
    if (provider === 'google') return await connectGoogle(undefined, full)
    return await connectGithub(full)
  } finally {
    endConnectSession(provider)
  }
}

export function disconnectProvider(provider: ConnectionProvider): void {
  if (provider === 'google') disconnectGoogle()
  else disconnectGithub()
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
}
