import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => {
  const store = new Map<string, string>()
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => {
        const id = `x${store.size}`
        store.set(id, s)
        return Buffer.from(id, 'utf8')
      },
      decryptString: (buf: Buffer) => {
        const id = buf.toString('utf8')
        const v = store.get(id)
        if (v == null) throw new Error('unknown')
        return v
      }
    }
  }
})

import {
  encryptApiKey,
  decryptApiKey,
  encryptProvidersInConfig,
  decryptProvidersInConfig,
  ENC_PREFIX
} from '../providerSecrets'

describe('providerSecrets', () => {
  beforeEach(() => {
    /* mock is module-level */
  })

  it('round-trips api keys', () => {
    const enc = encryptApiKey('sk-test-secret-key')
    expect(enc).toMatch(new RegExp(`^${ENC_PREFIX}`))
    expect(decryptApiKey(enc)).toBe('sk-test-secret-key')
  })

  it('leaves empty alone', () => {
    expect(encryptApiKey('')).toBe('')
    expect(encryptApiKey(undefined)).toBeUndefined()
  })

  it('encrypts providers in config', () => {
    const sealed = encryptProvidersInConfig({
      providers: [{ id: '1', name: 'X', apiFormat: 'openai', authMethod: 'key', baseUrl: '', apiKey: 'abc', enabled: true }],
      models: []
    })
    expect(sealed.providers?.[0].apiKey).toMatch(new RegExp(`^${ENC_PREFIX}`))
    const open = decryptProvidersInConfig(sealed)
    expect(open.providers?.[0].apiKey).toBe('abc')
  })
})
