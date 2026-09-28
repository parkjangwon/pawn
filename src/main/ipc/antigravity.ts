import { shell } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { startOAuthLoopback } from '../connections/loopback'
import { openSessionFile, type OAuthSession } from '../oauth/sessionFile'
import {
  ANTIGRAVITY_PORT,
  ANTIGRAVITY_REDIRECT,
  exchangeAntigravityCode,
  fetchGoogleEmail,
  refreshAntigravityToken,
  resolveProjectId,
  startAntigravityLogin
} from '../oauth/antigravity'

/** Antigravity session. The refresh token stays in the main process. */
const sessions = openSessionFile('antigravity.json')
const REFRESH_SKEW_MS = 2 * 60_000

function statusOf(session: OAuthSession | null): { signedIn: boolean; email?: string; expiresAt?: number } {
  if (!session?.accessToken) return { signedIn: false }
  return { signedIn: true, email: session.email, expiresAt: session.expiresAt }
}

let loginAbort: AbortController | null = null
let closeLoop: (() => void) | null = null
let refreshFlight: Promise<OAuthSession | null> | null = null

function notify(result: { ok: boolean; email?: string; error?: string }): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('antigravity:loginDone', result)
}

async function ensureFresh(session: OAuthSession): Promise<OAuthSession | null> {
  let current = session
  if (current.expiresAt - Date.now() <= REFRESH_SKEW_MS) {
    if (!current.refreshToken) return current.expiresAt > Date.now() ? current : null
    if (!refreshFlight) {
      refreshFlight = (async () => {
        try {
          const tokens = await refreshAntigravityToken(fetch, current.refreshToken || '')
          const next: OAuthSession = {
            ...current,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || current.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000,
            email: tokens.email || current.email
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
    const refreshed = await refreshFlight
    if (!refreshed) return null
    current = refreshed
  }
  if (!current.projectId) {
    try {
      const projectId = await resolveProjectId(fetch, current.accessToken)
      if (projectId) {
        current = { ...current, projectId }
        sessions.save(current)
      }
    } catch {
      /* inference will surface a missing project */
    }
  }
  return current
}

export function registerAntigravityIpc(): void {
  handleTrusted('antigravity:status', () => statusOf(sessions.load()))

  handleTrusted('antigravity:startLogin', async () => {
    loginAbort?.abort()
    closeLoop?.()
    const controller = new AbortController()
    loginAbort = controller
    try {
      const start = startAntigravityLogin()
      const loop = await startOAuthLoopback(5 * 60_000, { port: ANTIGRAVITY_PORT, redirectUri: ANTIGRAVITY_REDIRECT })
      closeLoop = loop.close
      if (/^https:\/\//.test(start.url)) void shell.openExternal(start.url)
      void (async () => {
        try {
          const cb = await loop.wait()
          if (controller.signal.aborted) return
          if (cb.state && cb.state !== start.state) {
            notify({ ok: false, error: 'Antigravity sign-in state did not match' })
            return
          }
          if (cb.error || !cb.code) {
            notify({ ok: false, error: cb.errorDescription || cb.error || 'Antigravity sign-in failed' })
            return
          }
          const tokens = await exchangeAntigravityCode(fetch, cb.code, start.verifier, controller.signal)
          const email = await fetchGoogleEmail(fetch, tokens.accessToken, controller.signal)
          let projectId: string | undefined
          try {
            projectId = await resolveProjectId(fetch, tokens.accessToken, controller.signal)
          } catch (err) {
            notify({ ok: false, error: err instanceof Error ? err.message : String(err) })
            return
          }
          const session: OAuthSession = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000,
            email,
            projectId
          }
          sessions.save(session)
          notify({ ok: true, email })
        } catch (err) {
          if (controller.signal.aborted) return
          notify({ ok: false, error: err instanceof Error ? err.message : String(err) })
        } finally {
          loginAbort = null
          closeLoop = null
        }
      })()
      return {
        ok: true as const,
        verificationUri: start.url,
        verificationUriComplete: start.url
      }
    } catch (err) {
      loginAbort = null
      closeLoop = null
      const message = err instanceof Error ? err.message : String(err)
      const friendly = /EADDRINUSE|already in use/i.test(message)
        ? `Port ${ANTIGRAVITY_PORT} is already in use. Close the other sign-in window and try again.`
        : message
      return { ok: false as const, error: friendly }
    }
  })

  handleTrusted('antigravity:cancelLogin', async () => {
    loginAbort?.abort()
    loginAbort = null
    closeLoop?.()
    closeLoop = null
    return { ok: true }
  })

  handleTrusted('antigravity:signOut', () => {
    loginAbort?.abort()
    loginAbort = null
    closeLoop?.()
    closeLoop = null
    sessions.save(null)
    return { ok: true }
  })

  handleTrusted('antigravity:accessToken', async () => {
    const session = sessions.load()
    if (!session?.accessToken) return { ok: false as const, error: 'not signed in' }
    const fresh = await ensureFresh(session)
    if (!fresh?.accessToken) return { ok: false as const, error: 'Antigravity session expired' }
    return { ok: true as const, token: fresh.accessToken, projectId: fresh.projectId }
  })
}

export function disposeAntigravity(): void {
  loginAbort?.abort()
  loginAbort = null
  closeLoop?.()
  closeLoop = null
}
