import { handleTrusted } from './trust'
import { getConfigPath, getPawnDir, loadConfig, saveConfig, type PawnConfig } from '../config'
import {
  decryptProvidersInConfig,
  encryptProvidersInConfig,
  getSecretStorageStatus,
  preserveSealedProviderKeys,
  warnIfPlaintextSecrets
} from '../providerSecrets'

export function registerConfigIpc(): void {
  handleTrusted('config:load', async () => {
    try {
      const raw = loadConfig()
      // Decrypt apiKeys so the renderer always sees plaintext for HTTP calls.
      return decryptProvidersInConfig(raw)
    } catch (err) {
      console.error('[ipc] config:load failed:', err)
      return {}
    }
  })
  handleTrusted('config:save', async (_, config) => {
    if (config == null || typeof config !== 'object') {
      return { ok: false, error: 'Invalid config payload' }
    }
    try {
      // Encrypt keys before they hit disk. Merge happens inside saveConfig.
      const kept = preserveSealedProviderKeys(config as PawnConfig, loadConfig())
      const sealed = encryptProvidersInConfig(kept)
      if (sealed.providers?.some((p) => p.apiKey && !p.apiKey.startsWith('enc:'))) warnIfPlaintextSecrets()
      saveConfig(sealed)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handleTrusted('config:secretStorageStatus', async () => getSecretStorageStatus())
  handleTrusted('config:getPaths', async () => ({ configPath: getConfigPath(), dataDir: getPawnDir() }))
}
