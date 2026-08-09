/**
 * Encrypt BYOK provider API keys at rest with Electron safeStorage.
 * Stored form: `enc:v1:<base64 ciphertext>`. Plain keys are migrated on next save.
 */

import { safeStorage } from 'electron'
import type { PawnConfig, ProviderConfig } from './config'

export const ENC_PREFIX = 'enc:v1:'

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
