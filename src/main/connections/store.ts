/**
 * Local-only OAuth token store. Tokens never leave this machine.
 * Prefer Electron safeStorage when available; fall back to base64 (dev).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import { getPawnDir } from '../config'
import { EMBEDDED_OAUTH } from './oauthDefaults'
import type { ConnectionProvider, OAuthClientConfig, StoredTokens } from './types'

const CONNECTIONS_DIR = (): string => join(getPawnDir(), 'connections')
const CLIENTS_PATH = (): string => join(getPawnDir(), 'oauth-clients.json')

function tokenPath(provider: ConnectionProvider): string {
  return join(CONNECTIONS_DIR(), `${provider}.bin`)
}

function ensureDir(): void {
  const dir = CONNECTIONS_DIR()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function encodePayload(json: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(json)
  }
  return Buffer.from(json, 'utf8')
}

function decodePayload(buf: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf)
    } catch {
      // Older plain file during migration
    }
  }
  return buf.toString('utf8')
}

export function loadTokens(provider: ConnectionProvider): StoredTokens | null {
  const p = tokenPath(provider)
  if (!existsSync(p)) return null
  try {
    const raw = decodePayload(readFileSync(p))
    const data = JSON.parse(raw) as StoredTokens
    if (!data?.accessToken) return null
    return data
  } catch {
    return null
  }
}

export function saveTokens(provider: ConnectionProvider, tokens: StoredTokens): void {
  ensureDir()
  writeFileSync(tokenPath(provider), encodePayload(JSON.stringify(tokens)))
}

export function clearTokens(provider: ConnectionProvider): void {
  const p = tokenPath(provider)
  if (existsSync(p)) {
    try { unlinkSync(p) } catch { /* ignore */ }
  }
}

/** Optional power-user override file (no Settings UI). */
export function loadOAuthClients(): OAuthClientConfig {
  const p = CLIENTS_PATH()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as OAuthClientConfig
  } catch {
    return {}
  }
}

export function saveOAuthClients(patch: OAuthClientConfig): OAuthClientConfig {
  ensureDir()
  const next = { ...loadOAuthClients(), ...patch }
  writeFileSync(CLIENTS_PATH(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/**
 * Resolve client credentials.
 * Priority: runtime env → ~/.pawn/oauth-clients.json → build-time embedded.
 */
function pick(envKey: string, fileVal: string | undefined, embedded: string): string {
  return (process.env[envKey] || fileVal || embedded || '').trim()
}

export function getGoogleClientId(): string {
  return pick('PAWN_GOOGLE_CLIENT_ID', loadOAuthClients().googleClientId, EMBEDDED_OAUTH.googleClientId)
}

export function getGoogleClientSecret(): string {
  return pick(
    'PAWN_GOOGLE_CLIENT_SECRET',
    loadOAuthClients().googleClientSecret,
    EMBEDDED_OAUTH.googleClientSecret
  )
}

export function getGithubClientId(): string {
  return pick('PAWN_GITHUB_CLIENT_ID', loadOAuthClients().githubClientId, EMBEDDED_OAUTH.githubClientId)
}

export function getGithubClientSecret(): string {
  return pick(
    'PAWN_GITHUB_CLIENT_SECRET',
    loadOAuthClients().githubClientSecret,
    EMBEDDED_OAUTH.githubClientSecret
  )
}
