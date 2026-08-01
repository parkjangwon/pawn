import { ipcMain } from 'electron'
import { handleTrusted } from './trust'
import { loadConfig, saveConfig } from '../config'

export function registerConfigIpc(): void {
  handleTrusted('config:load', async () => loadConfig())
  handleTrusted('config:save', async (_, config) => { saveConfig(config); return { ok: true } })
}
