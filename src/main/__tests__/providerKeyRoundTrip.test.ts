import { afterEach, describe, expect, it } from 'vitest'
import { decryptProvidersInConfig, encryptProvidersInConfig, ENC_PREFIX, setSecretCipher, type SecretCipher } from '../providerSecrets'
import type { PawnConfig } from '../config'

// Storage half of "add provider → Test connection": the key typed in Settings
// must come back from load intact on both storage paths. The request half is
// src/renderer/src/agent/__tests__/providerKeyTestConnection.test.ts.
const DUMMY = 'dummy-not-a-real-key'
const fakeKeychain: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Array.from(Buffer.from(s, 'utf8'), (b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(Array.from(b, (x) => x ^ 0x5a)).toString('utf8'),
  getSelectedStorageBackend: () => 'gnome_libsecret'
}
const cfg = (apiKey: string): PawnConfig =>
  ({ providers: [{ id: 'p1', name: 'MockRouter', apiFormat: 'openai', baseUrl: 'http://localhost:18080/v1', apiKey, enabled: true }] }) as unknown as PawnConfig

afterEach(() => setSecretCipher(null))

describe('provider key save → load round trip', () => {
  it('keychain path seals on save and returns the same key on load', () => {
    setSecretCipher(fakeKeychain)
    const saved = encryptProvidersInConfig(cfg(DUMMY))
    expect(saved.providers![0].apiKey!.startsWith(ENC_PREFIX)).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(DUMMY)
    expect(decryptProvidersInConfig(saved).providers![0].apiKey).toBe(DUMMY)
  })

  it('plaintext fallback (no keychain) stores and loads the same key', () => {
    setSecretCipher({ isEncryptionAvailable: () => false, encryptString: () => { throw new Error('x') }, decryptString: () => { throw new Error('x') } })
    const saved = encryptProvidersInConfig(cfg(DUMMY))
    expect(saved.providers![0].apiKey).toBe(DUMMY)
    expect(decryptProvidersInConfig(saved).providers![0].apiKey).toBe(DUMMY)
  })
})
