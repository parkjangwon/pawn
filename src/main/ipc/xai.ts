import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { safeStorage, shell } from 'electron'
import { handleTrusted } from './trust'
import { getPawnDir } from '../config'
import { getMainWindow } from '../window'
import {
  fetchUserEmail,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  type XaiDeviceCode
} from '../xai/oauth'

/** Encrypted xAI session. The refresh token never crosses into the renderer. */
interface XaiSession {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt: number
  email?: string
}

const REFRESH_SKEW_MS = 2 * 60_000

function securePath(): string {
  return join(getPawnDir(), 'xai.json')
}

function loadSession(): XaiSession | null {
  if (!safeStorage.isEncryptionAvailable() || !existsSync(securePath())) return memory
  try {
    const raw = JSON.parse(readFileSync(securePath(), 'utf8')) as { v: number; data: string }
    return JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64'))) as XaiSession
  } catch {
    return null
  }
}

let memory: XaiSession | null = null

function saveSession(session: XaiSession | null): void {
  memory = session
  if (!safeStorage.isEncryptionAvailable()) return
  if (!session) {
    rmSync(securePath(), { force: true })
    return
  }
  const data = safeStorage.encryptString(JSON.stringify(session)).toString('base64')
  writeFileSync(securePath(), JSON.stringify({ v: 1, data }), { encoding: 'utf8', mode: 0o600 })
}

function statusOf(session: XaiSession | null): { signedIn: boolean; email?: string; expiresAt?: number } {
  if (!session?.accessToken) return { signedIn: false }
  return { signedIn: true, email: session.email, expiresAt: session.expiresAt }
}

let loginAbort: AbortController | null = null
let refreshFlight: Promise<XaiSession | null> | null = null

function notify(result: { ok: boolean; email?: string; error?: string }): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('xai:loginDone', result)
}

async function ensureFresh(session: XaiSession): Promise<XaiSession | null> {
  if (session.expiresAt - Date.now() > REFRESH_SKEW_MS) return session
  if (!session.refreshToken) return session.expiresAt > Date.now() ? session : null
  if (!refreshFlight) {
    refreshFlight = (async () => {
      try {
        const tokens = await refreshAccessToken(fetch, session.refreshToken || '')
        const next: XaiSession = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || session.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          email: session.email
        }
        saveSession(next)
        return next
      } catch {
        saveSession(null)
        return null
      } finally {
        refreshFlight = null
      }
    })()
  }
  return refreshFlight
}

async function runLogin(device: XaiDeviceCode, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + device.expiresIn * 1000
  let wait = device.intervalMs
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (signal.aborted) return
      const poll = await pollDeviceToken(fetch, device.deviceCode, signal)
      if (poll.kind === 'pending') {
        if (poll.slowDown) wait += 5000
        continue
      }
      if (poll.kind === 'error') {
        notify({ ok: false, error: poll.message })
        return
      }
      const email = await fetchUserEmail(fetch, poll.tokens.accessToken)
      const session: XaiSession = {
        accessToken: poll.tokens.accessToken,
        refreshToken: poll.tokens.refreshToken,
        expiresAt: Date.now() + poll.tokens.expiresIn * 1000,
        email
      }
      saveSession(session)
      notify({ ok: true, email })
      return
    }
    notify({ ok: false, error: 'xAI sign-in timed out' })
  } catch (err) {
    if (signal.aborted) return
    notify({ ok: false, error: err instanceof Error ? err.message : String(err) })
  } finally {
    loginAbort = null
  }
}

export function registerXaiIpc(): void {
  handleTrusted('xai:status', () => statusOf(loadSession()))

  handleTrusted('xai:startLogin', async () => {
    loginAbort?.abort()
    const controller = new AbortController()
    loginAbort = controller
    try {
      const device = await requestDeviceCode(fetch, controller.signal)
      const url = device.verificationUriComplete || device.verificationUri
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
      void runLogin(device, controller.signal)
      return {
        ok: true as const,
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        verificationUriComplete: device.verificationUriComplete,
        expiresIn: device.expiresIn
      }
    } catch (err) {
      loginAbort = null
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handleTrusted('xai:cancelLogin', async () => {
    loginAbort?.abort()
    loginAbort = null
    return { ok: true }
  })

  handleTrusted('xai:signOut', () => {
    loginAbort?.abort()
    loginAbort = null
    saveSession(null)
    return { ok: true }
  })

  handleTrusted('xai:accessToken', async () => {
    const session = loadSession()
    if (!session?.accessToken) return { ok: false as const, error: 'not signed in' }
    const fresh = await ensureFresh(session)
    if (!fresh?.accessToken) return { ok: false as const, error: 'xAI session expired' }
    return { ok: true as const, token: fresh.accessToken }
  })
}

export function disposeXai(): void {
  loginAbort?.abort()
  loginAbort = null
}
