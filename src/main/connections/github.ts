import { shell } from 'electron'
import {
  getGithubClientId,
  getGithubClientSecret,
  loadTokens,
  saveTokens,
  clearTokens
} from './store'
import { randomString } from './pkce'
import { startOAuthLoopback } from './loopback'
import {
  endConnectSession,
  isConnectCancelled,
  registerSessionCloser,
  type ConnectHooks
} from './session'
import type { StoredTokens } from './types'

export type { ConnectHooks }

/** Device flow is preferred (no redirect), but needs a registered OAuth App client id. */
export async function connectGithub(hooks: ConnectHooks = {}): Promise<{
  ok?: boolean
  error?: string
  accountLabel?: string
  userCode?: string
  verificationUri?: string
  cancelled?: boolean
}> {
  const clientId = getGithubClientId()
  if (!clientId) {
    return {
      error:
        'GitHub OAuth is not configured in this build. Set PAWN_GITHUB_CLIENT_ID or rebuild with embedded defaults.'
    }
  }

  const device = await startGithubDeviceFlow(clientId, hooks)
  if (device.ok || device.error || device.cancelled) return device

  // Fallback: authorization code + loopback (requires callback URL registered).
  return connectGithubLoopback(clientId, hooks)
}

async function startGithubDeviceFlow(
  clientId: string,
  hooks: ConnectHooks
): Promise<{
  ok?: boolean
  error?: string
  accountLabel?: string
  userCode?: string
  verificationUri?: string
  pending?: boolean
  cancelled?: boolean
}> {
  const { signal, onProgress } = hooks
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'repo read:user user:email read:org'
      })
    })
    const j = (await res.json()) as {
      device_code?: string
      user_code?: string
      verification_uri?: string
      expires_in?: number
      interval?: number
      error?: string
      error_description?: string
    }
    if (!res.ok || !j.device_code || !j.user_code) {
      if (j.error === 'unsupported_grant_type' || res.status === 404 || res.status === 401) {
        return {}
      }
      return { error: j.error_description || j.error || `Device auth failed (${res.status})` }
    }

    const verificationUri = j.verification_uri || 'https://github.com/login/device'
    const userCode = j.user_code

    // Surface code immediately so the user can type it on github.com/login/device
    onProgress?.({
      phase: 'device_code',
      userCode,
      verificationUri,
      message: 'Enter this code on GitHub'
    })

    const openUri = `${verificationUri}${verificationUri.includes('?') ? '&' : '?'}user_code=${encodeURIComponent(userCode)}`
    await shell.openExternal(openUri)
    onProgress?.({ phase: 'polling', userCode, verificationUri })

    let cancelled = false
    registerSessionCloser('github', () => {
      cancelled = true
    })
    if (signal) {
      const onAbort = (): void => {
        cancelled = true
      }
      if (signal.aborted) cancelled = true
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const intervalMs = Math.max(5, j.interval || 5) * 1000
    const deadline = Date.now() + (j.expires_in || 900) * 1000

    while (Date.now() < deadline) {
      if (cancelled || isConnectCancelled(signal)) {
        endConnectSession('github')
        return { cancelled: true, error: 'Cancelled' }
      }
      await sleep(intervalMs)
      if (cancelled || isConnectCancelled(signal)) {
        endConnectSession('github')
        return { cancelled: true, error: 'Cancelled' }
      }

      const poll = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: j.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })
      const pj = (await poll.json()) as {
        access_token?: string
        token_type?: string
        scope?: string
        error?: string
        error_description?: string
      }
      if (pj.access_token) {
        const tokens: StoredTokens = {
          accessToken: pj.access_token,
          tokenType: pj.token_type,
          scope: pj.scope,
          updatedAt: Date.now()
        }
        const label = await fetchGithubLogin(tokens.accessToken)
        if (label) tokens.accountLabel = label
        saveTokens('github', tokens)
        endConnectSession('github')
        return { ok: true, accountLabel: tokens.accountLabel }
      }
      if (pj.error === 'authorization_pending' || pj.error === 'slow_down') {
        if (pj.error === 'slow_down') await sleep(intervalMs)
        continue
      }
      if (pj.error === 'expired_token' || pj.error === 'access_denied') {
        endConnectSession('github')
        return { error: pj.error_description || pj.error }
      }
      if (pj.error === 'incorrect_client_credentials' || pj.error === 'unsupported_grant_type') {
        endConnectSession('github')
        return {}
      }
      endConnectSession('github')
      return { error: pj.error_description || pj.error || 'GitHub device authorization failed' }
    }
    endConnectSession('github')
    return { error: 'GitHub device authorization timed out' }
  } catch (e) {
    endConnectSession('github')
    if (isConnectCancelled(hooks.signal)) return { cancelled: true, error: 'Cancelled' }
    // Empty object → try loopback fallback
    if (e instanceof Error && e.message) return {}
    return {}
  }
}

async function connectGithubLoopback(
  clientId: string,
  hooks: ConnectHooks
): Promise<{ ok?: boolean; error?: string; accountLabel?: string; cancelled?: boolean }> {
  const loop = await startOAuthLoopback()
  registerSessionCloser('github', () => loop.close())
  const state = randomString(16)
  const auth = new URL('https://github.com/login/oauth/authorize')
  auth.searchParams.set('client_id', clientId)
  auth.searchParams.set('redirect_uri', loop.redirectUri)
  auth.searchParams.set('scope', 'repo read:user user:email read:org')
  auth.searchParams.set('state', state)

  try {
    hooks.onProgress?.({ phase: 'browser', message: 'Complete sign-in in the browser' })
    await shell.openExternal(auth.toString())
    const cb = await loop.wait()
    if (isConnectCancelled(hooks.signal)) {
      endConnectSession('github')
      return { cancelled: true, error: 'Cancelled' }
    }
    if (cb.error) {
      endConnectSession('github')
      return { error: cb.errorDescription || cb.error }
    }
    if (!cb.code) {
      endConnectSession('github')
      return { error: 'No authorization code returned' }
    }

    const secret = getGithubClientSecret()
    const body: Record<string, string> = {
      client_id: clientId,
      code: cb.code,
      redirect_uri: loop.redirectUri
    }
    if (secret) body.client_secret = secret

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string
      token_type?: string
      scope?: string
      error?: string
      error_description?: string
    }
    if (!tokenRes.ok || !tokenJson.access_token) {
      endConnectSession('github')
      return {
        error:
          tokenJson.error_description ||
          tokenJson.error ||
          (secret
            ? `Token exchange failed (${tokenRes.status})`
            : 'Token exchange failed — prefer Device Flow for desktop.')
      }
    }

    const tokens: StoredTokens = {
      accessToken: tokenJson.access_token,
      tokenType: tokenJson.token_type,
      scope: tokenJson.scope,
      updatedAt: Date.now()
    }
    const label = await fetchGithubLogin(tokens.accessToken)
    if (label) tokens.accountLabel = label
    saveTokens('github', tokens)
    endConnectSession('github')
    return { ok: true, accountLabel: tokens.accountLabel }
  } catch (e) {
    loop.close()
    endConnectSession('github')
    if (isConnectCancelled(hooks.signal)) return { cancelled: true, error: 'Cancelled' }
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function fetchGithubLogin(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Pawn-Desktop'
      }
    })
    if (!res.ok) return undefined
    const j = (await res.json()) as { login?: string; name?: string }
    return j.login || j.name
  } catch {
    return undefined
  }
}

export function getGithubAccessToken(): string | null {
  return loadTokens('github')?.accessToken || null
}

export function disconnectGithub(): void {
  clearTokens('github')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
