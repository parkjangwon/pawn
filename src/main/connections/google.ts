import { shell } from 'electron'
import {
  getGoogleClientId,
  getGoogleClientSecret,
  loadTokens,
  saveTokens,
  clearTokens
} from './store'
import { randomString, codeChallengeS256 } from './pkce'
import { startOAuthLoopback } from './loopback'
import {
  endConnectSession,
  isConnectCancelled,
  registerSessionCloser,
  type ConnectHooks,
  type ConnectProgress
} from './session'
import type { StoredTokens } from './types'

/**
 * Read-only Workspace defaults — agent can see Drive + office suite + mail/calendar.
 * Write scopes intentionally omitted until product tools need them.
 *
 * Note: drive.readonly covers file download/export; Sheets/Docs/Slides scopes
 * enable the dedicated APIs (values, document structure, presentation JSON).
 * After changing this list, users must Disconnect → Connect again.
 */
export const GOOGLE_DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  // Drive (files + export of Docs/Sheets/Slides binaries)
  'https://www.googleapis.com/auth/drive.readonly',
  // Dedicated Workspace APIs
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
  // Communication / schedule
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly'
].join(' ')

export async function connectGoogle(
  scopes = GOOGLE_DEFAULT_SCOPES,
  hooks: ConnectHooks = {}
): Promise<{ ok?: boolean; error?: string; accountLabel?: string; cancelled?: boolean }> {
  const clientId = getGoogleClientId()
  if (!clientId) {
    return {
      error:
        'Google OAuth is not configured in this build. Set PAWN_GOOGLE_CLIENT_ID or rebuild with embedded defaults.'
    }
  }

  const loop = await startOAuthLoopback()
  registerSessionCloser('google', () => loop.close())
  const verifier = randomString(32)
  const challenge = codeChallengeS256(verifier)
  const state = randomString(16)

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', clientId)
  auth.searchParams.set('redirect_uri', loop.redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', scopes)
  auth.searchParams.set('access_type', 'offline')
  auth.searchParams.set('prompt', 'consent')
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  auth.searchParams.set('state', state)

  try {
    hooks.onProgress?.({
      phase: 'browser',
      message: 'Complete Google sign-in in the browser'
    } satisfies Omit<ConnectProgress, 'provider'>)
    await shell.openExternal(auth.toString())
    const cb = await loop.wait()
    if (isConnectCancelled(hooks.signal)) {
      endConnectSession('google')
      return { cancelled: true, error: 'Cancelled' }
    }
    if (cb.error) {
      endConnectSession('google')
      return { error: cb.errorDescription || cb.error }
    }
    if (!cb.code) {
      endConnectSession('google')
      return { error: 'No authorization code returned' }
    }

    const body = new URLSearchParams({
      code: cb.code,
      client_id: clientId,
      redirect_uri: loop.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
    const secret = getGoogleClientSecret()
    if (secret) body.set('client_secret', secret)

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
      error?: string
      error_description?: string
    }
    if (!tokenRes.ok || !tokenJson.access_token) {
      endConnectSession('google')
      return {
        error:
          tokenJson.error_description ||
          tokenJson.error ||
          `Token exchange failed (${tokenRes.status})`
      }
    }

    const prev = loadTokens('google')
    const tokens: StoredTokens = {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token || prev?.refreshToken,
      expiresAt: tokenJson.expires_in ? Date.now() + tokenJson.expires_in * 1000 : undefined,
      tokenType: tokenJson.token_type,
      scope: tokenJson.scope || scopes,
      updatedAt: Date.now()
    }

    const label = await fetchGoogleAccountLabel(tokens.accessToken)
    if (label) tokens.accountLabel = label
    saveTokens('google', tokens)
    endConnectSession('google')
    return { ok: true, accountLabel: tokens.accountLabel }
  } catch (e) {
    loop.close()
    endConnectSession('google')
    if (isConnectCancelled(hooks.signal)) return { cancelled: true, error: 'Cancelled' }
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function fetchGoogleAccountLabel(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return undefined
    const j = (await res.json()) as { email?: string; name?: string }
    return j.email || j.name
  } catch {
    return undefined
  }
}

export async function refreshGoogleAccessToken(): Promise<StoredTokens | null> {
  const cur = loadTokens('google')
  if (!cur?.refreshToken) return cur
  if (cur.expiresAt && cur.expiresAt > Date.now() + 60_000) return cur

  const clientId = getGoogleClientId()
  if (!clientId) return cur

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: cur.refreshToken
  })
  const secret = getGoogleClientSecret()
  if (secret) body.set('client_secret', secret)

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const j = (await res.json()) as {
      access_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
    }
    if (!res.ok || !j.access_token) return cur
    const next: StoredTokens = {
      ...cur,
      accessToken: j.access_token,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : cur.expiresAt,
      scope: j.scope || cur.scope,
      tokenType: j.token_type || cur.tokenType,
      updatedAt: Date.now()
    }
    saveTokens('google', next)
    return next
  } catch {
    return cur
  }
}

export async function getGoogleAccessToken(): Promise<string | null> {
  const t = await refreshGoogleAccessToken()
  return t?.accessToken || null
}

export function disconnectGoogle(): void {
  clearTokens('google')
}
