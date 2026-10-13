import { describe, it, expect, beforeEach } from 'vitest'
import { setSecretCipher } from '../providerSecrets'
import { fakeCipher } from './fakeCipher'

setSecretCipher(fakeCipher())


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

describe('providerSecrets without a cipher (headless)', () => {
  it('stores keys as-is and refuses to surface ciphertext', () => {
    const sealed = encryptApiKey('sk-sealed-before')
    setSecretCipher(null)
    try {
      expect(encryptApiKey('sk-plain-key')).toBe('sk-plain-key')
      expect(decryptApiKey(sealed)).toBe('')
    } finally {
      setSecretCipher(fakeCipher())
    }
  })
})
