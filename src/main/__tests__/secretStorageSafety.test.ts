import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  ENC_PREFIX,
  decryptProvidersInConfig,
  encryptApiKey,
  getSecretStorageStatus,
  preserveSealedProviderKeys,
  setSecretCipher,
  warnIfPlaintextSecrets,
  type SecretCipher
} from '../providerSecrets'
import type { PawnConfig, ProviderConfig } from '../config'
import { fakeCipher } from './fakeCipher'

const prov = (id: string, apiKey?: string): ProviderConfig => ({
  id, name: id, apiFormat: 'openai', authMethod: 'api-key', baseUrl: 'https://x', apiKey, enabled: true
})

afterEach(() => setSecretCipher(fakeCipher()))

describe('getSecretStorageStatus / warnIfPlaintextSecrets', () => {
  it('reports no-cipher when nothing is installed', () => {
    setSecretCipher(null)
    expect(getSecretStorageStatus()).toEqual({ encrypted: false, reason: 'no-cipher' })
  })

  it('reports unavailable when the keychain cannot encrypt (Linux, no keyring)', () => {
    setSecretCipher({ ...fakeCipher(), isEncryptionAvailable: () => false })
    expect(getSecretStorageStatus()).toEqual({ encrypted: false, reason: 'unavailable' })
  })

  it('treats the Linux basic_text backend as plaintext', () => {
    const c: SecretCipher = { ...fakeCipher(), getSelectedStorageBackend: () => 'basic_text' }
    setSecretCipher(c)
    expect(getSecretStorageStatus()).toEqual({ encrypted: false, reason: 'basic_text', backend: 'basic_text' })
  })

  it('reports encrypted for a real backend', () => {
    setSecretCipher({ ...fakeCipher(), getSelectedStorageBackend: () => 'gnome_libsecret' })
    expect(getSecretStorageStatus()).toEqual({ encrypted: true, backend: 'gnome_libsecret' })
  })

  it('logs the plaintext warning only once per cipher, never when encrypted', () => {
    const log = vi.fn()
    setSecretCipher({ ...fakeCipher(), isEncryptionAvailable: () => false })
    expect(warnIfPlaintextSecrets(log)).toBe(true)
    expect(warnIfPlaintextSecrets(log)).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(/plain text/)
    setSecretCipher(fakeCipher())
    expect(warnIfPlaintextSecrets(log)).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe('preserveSealedProviderKeys', () => {
  it('keeps enc: keys when saving without a cipher (decrypt yielded "")', () => {
    const sealed = encryptApiKey('sk-original')!
    expect(sealed.startsWith(ENC_PREFIX)).toBe(true)
    const onDisk: PawnConfig = { providers: [prov('a', sealed), prov('b', 'sk-plain')] }
    setSecretCipher(null)
    // Renderer loads (enc → '') and saves the whole providers array back.
    const loaded = decryptProvidersInConfig(onDisk)
    expect(loaded.providers?.[0].apiKey).toBe('')
    const out = preserveSealedProviderKeys(loaded, onDisk)
    expect(out.providers?.[0].apiKey).toBe(sealed)
    expect(out.providers?.[1].apiKey).toBe('sk-plain')
  })

  it('lets a newly entered key replace the sealed one', () => {
    const sealed = encryptApiKey('sk-original')!
    setSecretCipher(null)
    const out = preserveSealedProviderKeys({ providers: [prov('a', 'sk-new')] }, { providers: [prov('a', sealed)] })
    expect(out.providers?.[0].apiKey).toBe('sk-new')
  })

  it('allows clearing a key that is readable with the current cipher', () => {
    const sealed = encryptApiKey('sk-original')!
    const out = preserveSealedProviderKeys({ providers: [prov('a', '')] }, { providers: [prov('a', sealed)] })
    expect(out.providers?.[0].apiKey).toBe('')
  })

  it('does not resurrect keys of deleted providers or touch non-provider saves', () => {
    const sealed = encryptApiKey('sk-original')!
    setSecretCipher(null)
    const onDisk: PawnConfig = { providers: [prov('a', sealed)] }
    expect(preserveSealedProviderKeys({ providers: [prov('b', '')] }, onDisk).providers).toEqual([prov('b', '')])
    const settingsOnly = { settings: { theme: 'dark' } } as unknown as PawnConfig
    expect(preserveSealedProviderKeys(settingsOnly, onDisk)).toBe(settingsOnly)
  })
})
