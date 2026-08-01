import { dialog, ipcMain } from 'electron'
import { handleTrusted } from './trust'

export function registerDialogIpc(): void {
  handleTrusted('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
