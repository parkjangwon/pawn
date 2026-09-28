import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import { getPawnDir } from '../config'

/**
 * Encrypted OAuth session under ~/.pawn. The refresh token never crosses into
 * the renderer; callers receive a fresh access token only.
 */
export interface OAuthSession {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt: number
  email?: string
  /** ChatGPT workspace id from the ID token. */
  accountId?: string
  /** Antigravity / Cloud Code project id. */
  projectId?: string
  idToken?: string
}

export function openSessionFile(filename: string): {
  load: () => OAuthSession | null
  save: (session: OAuthSession | null) => void
} {
  let memory: OAuthSession | null = null
  const path = (): string => join(getPawnDir(), filename)

  return {
    load(): OAuthSession | null {
      if (!safeStorage.isEncryptionAvailable() || !existsSync(path())) return memory
      try {
        const raw = JSON.parse(readFileSync(path(), 'utf8')) as { v: number; data: string }
        return JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64'))) as OAuthSession
      } catch {
        return null
      }
    },
    save(session: OAuthSession | null): void {
      memory = session
      if (!safeStorage.isEncryptionAvailable()) return
      if (!session) {
        rmSync(path(), { force: true })
        return
      }
      const data = safeStorage.encryptString(JSON.stringify(session)).toString('base64')
      writeFileSync(path(), JSON.stringify({ v: 1, data }), { encoding: 'utf8', mode: 0o600 })
    }
  }
}
