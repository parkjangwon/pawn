import { shell } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { openSessionFile, type OAuthSession } from '../oauth/sessionFile'
import {
  exchangeClaudeCode,
  parseClaudeCallback,
  refreshClaudeToken,
  startClaudeLogin,
  type ClaudeLoginStart
} from '../oauth/claude'

/** Claude subscription session. The refresh token stays in the main process. */
const sessions = openSessionFile('claude.json')
const REFRESH_SKEW_MS = 2 * 60_000

function statusOf(session: OAuthSession | null): { signedIn: boolean; email?: string; expiresAt?: number } {
  if (!session?.accessToken) return { signedIn: false }
  return { signedIn: true, email: session.email, expiresAt: session.expiresAt }
}

let pending: ClaudeLoginStart | null = null
let refreshFlight: Promise<OAuthSession | null> | null = null

function notify(result: { ok: boolean; email?: string; error?: string }): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('claudeOauth:loginDone', result)
}

async function ensureFresh(session: OAuthSession): Promise<OAuthSession | null> {
  if (session.expiresAt - Date.now() > REFRESH_SKEW_MS) return session
  if (!session.refreshToken) return session.expiresAt > Date.now() ? session : null
  if (!refreshFlight) {
    refreshFlight = (async () => {
      try {
        const tokens = await refreshClaudeToken(fetch, session.refreshToken || '')
        const next: OAuthSession = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || session.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          email: tokens.email || session.email
        }
        sessions.save(next)
        return next
      } catch {
        sessions.save(null)
        return null
      } finally {
        refreshFlight = null
      }
    })()
  }
  return refreshFlight
}

function storeTokens(tokens: { accessToken: string; refreshToken?: string; expiresIn: number; email?: string }, previous?: OAuthSession | null): OAuthSession {
  const session: OAuthSession = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || previous?.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    email: tokens.email || previous?.email
  }
  sessions.save(session)
  return session
}

export function registerClaudeOauthIpc(): void {
  handleTrusted('claudeOauth:status', () => statusOf(sessions.load()))

  handleTrusted('claudeOauth:startLogin', async () => {
    try {
      const start = startClaudeLogin()
      pending = start
      if (/^https:\/\//.test(start.url)) void shell.openExternal(start.url)
      return { ok: true as const, verificationUri: start.url, verificationUriComplete: start.url }
    } catch (err) {
      pending = null
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handleTrusted('claudeOauth:submitCode', async (_evt, code: unknown) => {
    const attempt = pending
    if (!attempt) return { ok: false as const, error: 'Start Claude sign-in first' }
    const parsed = parseClaudeCallback(typeof code === 'string' ? code : '')
    if (!parsed.code) return { ok: false as const, error: 'Paste the code from the Claude page' }
    if (parsed.state && parsed.state !== attempt.state) {
      return { ok: false as const, error: 'That code does not match this sign-in attempt' }
    }
    try {
      const tokens = await exchangeClaudeCode(fetch, {
        code: parsed.code,
        verifier: attempt.verifier,
        state: parsed.state || attempt.state
      })
      pending = null
      const session = storeTokens(tokens)
      notify({ ok: true, email: session.email })
      return { ok: true as const, email: session.email }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notify({ ok: false, error: message })
      return { ok: false as const, error: message }
    }
  })

  handleTrusted('claudeOauth:cancelLogin', async () => {
    pending = null
    return { ok: true }
  })

  handleTrusted('claudeOauth:signOut', () => {
    pending = null
    sessions.save(null)
    return { ok: true }
  })

  handleTrusted('claudeOauth:accessToken', async () => {
    const session = sessions.load()
    if (!session?.accessToken) return { ok: false as const, error: 'not signed in' }
    const fresh = await ensureFresh(session)
    if (!fresh?.accessToken) return { ok: false as const, error: 'Claude session expired' }
    return { ok: true as const, token: fresh.accessToken }
  })
}

export function disposeClaudeOauth(): void {
  pending = null
}
