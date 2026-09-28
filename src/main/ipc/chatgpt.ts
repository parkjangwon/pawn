import { shell } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { openSessionFile, type OAuthSession } from '../oauth/sessionFile'
import {
  exchangeDeviceCode,
  pollDeviceCode,
  refreshAccessToken,
  requestDeviceCode,
  type ChatGptDevice
} from '../oauth/chatgpt'

/** ChatGPT subscription session. The refresh token stays in the main process. */
const sessions = openSessionFile('chatgpt.json')
const REFRESH_SKEW_MS = 2 * 60_000

function statusOf(session: OAuthSession | null): { signedIn: boolean; email?: string; expiresAt?: number } {
  if (!session?.accessToken) return { signedIn: false }
  return { signedIn: true, email: session.email, expiresAt: session.expiresAt }
}

let loginAbort: AbortController | null = null
let refreshFlight: Promise<OAuthSession | null> | null = null

function notify(result: { ok: boolean; email?: string; error?: string }): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('chatgpt:loginDone', result)
}

async function ensureFresh(session: OAuthSession): Promise<OAuthSession | null> {
  if (session.expiresAt - Date.now() > REFRESH_SKEW_MS) return session
  if (!session.refreshToken) return session.expiresAt > Date.now() ? session : null
  if (!refreshFlight) {
    refreshFlight = (async () => {
      try {
        const tokens = await refreshAccessToken(fetch, session.refreshToken || '')
        const next: OAuthSession = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || session.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          email: tokens.email || session.email,
          accountId: tokens.accountId || session.accountId,
          idToken: tokens.idToken || session.idToken
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

async function runLogin(device: ChatGptDevice, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + device.expiresIn * 1000
  const wait = device.intervalMs
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (signal.aborted) return
      const poll = await pollDeviceCode(fetch, device.deviceAuthId, device.userCode, signal)
      if (poll.kind === 'pending') continue
      if (poll.kind === 'error') {
        notify({ ok: false, error: poll.message })
        return
      }
      const tokens = await exchangeDeviceCode(fetch, poll.authorizationCode, poll.codeVerifier, signal)
      const session: OAuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        email: tokens.email,
        accountId: tokens.accountId,
        idToken: tokens.idToken
      }
      sessions.save(session)
      notify({ ok: true, email: tokens.email })
      return
    }
    notify({ ok: false, error: 'ChatGPT sign-in timed out' })
  } catch (err) {
    if (signal.aborted) return
    notify({ ok: false, error: err instanceof Error ? err.message : String(err) })
  } finally {
    loginAbort = null
  }
}

export function registerChatGptIpc(): void {
  handleTrusted('chatgpt:status', () => statusOf(sessions.load()))

  handleTrusted('chatgpt:startLogin', async () => {
    loginAbort?.abort()
    const controller = new AbortController()
    loginAbort = controller
    try {
      const device = await requestDeviceCode(fetch, controller.signal)
      if (/^https:\/\//.test(device.verificationUri)) void shell.openExternal(device.verificationUri)
      void runLogin(device, controller.signal)
      return {
        ok: true as const,
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        verificationUriComplete: device.verificationUri,
        expiresIn: device.expiresIn
      }
    } catch (err) {
      loginAbort = null
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handleTrusted('chatgpt:cancelLogin', async () => {
    loginAbort?.abort()
    loginAbort = null
    return { ok: true }
  })

  handleTrusted('chatgpt:signOut', () => {
    loginAbort?.abort()
    loginAbort = null
    sessions.save(null)
    return { ok: true }
  })

  handleTrusted('chatgpt:accessToken', async () => {
    const session = sessions.load()
    if (!session?.accessToken) return { ok: false as const, error: 'not signed in' }
    const fresh = await ensureFresh(session)
    if (!fresh?.accessToken) return { ok: false as const, error: 'ChatGPT session expired' }
    return { ok: true as const, token: fresh.accessToken, accountId: fresh.accountId }
  })
}

export function disposeChatGpt(): void {
  loginAbort?.abort()
  loginAbort = null
}
