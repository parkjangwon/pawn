import type { SecretCipher } from '../providerSecrets'

/** Reversible in-memory stand-in for Electron safeStorage. */
export function fakeCipher(): SecretCipher {
  const store = new Map<string, string>()
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `k${store.size}`
      store.set(id, s)
      return Buffer.from(id, 'utf8')
    },
    decryptString: (buf: Buffer) => {
      const v = store.get(buf.toString('utf8'))
      if (v == null) throw new Error('unknown')
      return v
    }
  }
}
