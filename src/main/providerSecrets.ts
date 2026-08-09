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
