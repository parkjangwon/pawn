import { ipcMain } from 'electron'
import { loadConfig, saveConfig } from '../config'

export function registerConfigIpc(): void {
  ipcMain.handle('config:load', async () => loadConfig())
  ipcMain.handle('config:save', async (_, config) => { saveConfig(config); return { ok: true } })
}
