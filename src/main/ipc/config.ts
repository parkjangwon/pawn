import { handleTrusted } from './trust'
import { getConfigPath, getPawnDir, loadConfig, saveConfig } from '../config'

export function registerConfigIpc(): void {
  handleTrusted('config:load', async () => {
    try {
      return loadConfig()
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
      saveConfig(config)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handleTrusted('config:getPaths', async () => ({ configPath: getConfigPath(), dataDir: getPawnDir() }))
}
