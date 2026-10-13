/**
 * Encrypt BYOK provider API keys at rest with an injected OS-keychain cipher.
 * The Electron main process installs `safeStorage` at startup (src/main/index.ts);
 * this module stays electron-free so the headless CLI can bundle it. Without a
 * cipher, keys are stored as-is and `enc:` values decrypt to ''.
 * Stored form: `enc:v1:<base64 ciphertext>`. Plain keys are migrated on next save.
 */

import type { PawnConfig, ProviderConfig } from './config'

export const ENC_PREFIX = 'enc:v1:'

/** Structural subset of Electron's `safeStorage`. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only (Electron): 'basic_text' means a hardcoded key, i.e. no real protection. */
  getSelectedStorageBackend?(): string
}

export interface SecretStorageStatus {
  /** True only when keys are sealed by a real OS keychain backend. */
  encrypted: boolean
  /** Why keys end up effectively plaintext; absent when `encrypted`. */
  reason?: 'no-cipher' | 'unavailable' | 'basic_text'
  backend?: string
}

const NO_CIPHER: SecretCipher = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('no secret cipher installed')
  },
  decryptString: () => {
    throw new Error('no secret cipher installed')
  }
}

let safeStorage: SecretCipher = NO_CIPHER

let warnedPlaintext = false

export function setSecretCipher(cipher: SecretCipher | null): void {
  safeStorage = cipher ?? NO_CIPHER
  warnedPlaintext = false
}

/** Whether provider secrets written now would be protected at rest. */
export function getSecretStorageStatus(): SecretStorageStatus {
  if (safeStorage === NO_CIPHER) return { encrypted: false, reason: 'no-cipher' }
  let available = false
  try {
    available = safeStorage.isEncryptionAvailable()
  } catch {
    available = false
  }
  if (!available) return { encrypted: false, reason: 'unavailable' }
  let backend: string | undefined
  try {
    backend = safeStorage.getSelectedStorageBackend?.()
  } catch {
    backend = undefined
  }
  if (backend === 'basic_text') return { encrypted: false, reason: 'basic_text', backend }
  return backend ? { encrypted: true, backend } : { encrypted: true }
}

/** Log once per cipher that provider secrets are stored in plain text. */
export function warnIfPlaintextSecrets(log: (msg: string) => void = console.warn): boolean {
  const status = getSecretStorageStatus()
  if (status.encrypted || warnedPlaintext) return false
  warnedPlaintext = true
  log(
    `[secrets] OS keychain encryption unavailable (${status.reason}); provider API keys are stored in plain text in ~/.pawn/config.toml (mode 0600).`
  )
  return true
}

/**
 * Keep sealed keys that the caller could not see. Without a working cipher an
 * `enc:` value loads as '', so a settings save would otherwise wipe it. An
 * empty incoming key keeps the stored ciphertext when it cannot be decrypted;
 * any non-empty key the user typed wins.
 */
export function preserveSealedProviderKeys(incoming: PawnConfig, existing: PawnConfig): PawnConfig {
  if (!Array.isArray(incoming.providers) || !Array.isArray(existing.providers)) return incoming
  const stored = new Map(existing.providers.map((p) => [p.id, p.apiKey]))
  return {
    ...incoming,
    providers: incoming.providers.map((p: ProviderConfig): ProviderConfig => {
      if (p.apiKey) return p
      const prev = stored.get(p.id)
      if (!prev || !prev.startsWith(ENC_PREFIX)) return p
      if (decryptApiKey(prev)) return p // readable → the user really cleared it
      return { ...p, apiKey: prev }
    })
  }
}

export function encryptApiKey(key: string | undefined): string | undefined {
  if (key == null || key === '') return key
  if (key.startsWith(ENC_PREFIX)) return key
  if (!safeStorage.isEncryptionAvailable()) return key
  try {
    const buf = safeStorage.encryptString(key)
    return ENC_PREFIX + buf.toString('base64')
  } catch {
    return key
  }
}

export function decryptApiKey(key: string | undefined): string | undefined {
  if (key == null || key === '') return key
  if (!key.startsWith(ENC_PREFIX)) return key
  try {
    const buf = Buffer.from(key.slice(ENC_PREFIX.length), 'base64')
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf)
    }
    // Dev / headless: cannot decrypt OS keychain material — return empty
    // rather than leaking ciphertext into the model request.
    return ''
  } catch {
    return ''
  }
}

export function encryptProvidersInConfig(cfg: PawnConfig): PawnConfig {
  if (!Array.isArray(cfg.providers)) return cfg
  return {
    ...cfg,
    providers: cfg.providers.map(
      (p: ProviderConfig): ProviderConfig => ({
        ...p,
        apiKey: encryptApiKey(p.apiKey)
      })
    )
  }
}

export function decryptProvidersInConfig(cfg: PawnConfig): PawnConfig {
  if (!Array.isArray(cfg.providers)) return cfg
  return {
    ...cfg,
    providers: cfg.providers.map(
      (p: ProviderConfig): ProviderConfig => ({
        ...p,
        apiKey: decryptApiKey(p.apiKey)
      })
    )
  }
}

/** Encrypt secret-looking env/header values (API keys, tokens, passwords). */
export function encryptSecretMap(
  map: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!map) return map
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== 'string') continue
    if (looksLikeSecretKey(k) || looksLikeSecretValue(v)) {
      out[k] = encryptApiKey(v) || v
    } else {
      out[k] = v
    }
  }
  return out
}

export function decryptSecretMap(
  map: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!map) return map
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    out[k] = decryptApiKey(v) ?? v
  }
  return out
}

function looksLikeSecretKey(k: string): boolean {
  return /token|secret|password|api[_-]?key|auth|bearer|credential/i.test(k)
}

function looksLikeSecretValue(v: string): boolean {
  if (v.startsWith(ENC_PREFIX)) return true
  if (/^sk-[A-Za-z0-9_-]{10,}/.test(v)) return true
  if (/^gh[pousr]_[A-Za-z0-9]{10,}/.test(v)) return true
  if (/^Bearer\s+/i.test(v)) return true
  return false
}
