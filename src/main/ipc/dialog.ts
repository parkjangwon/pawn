import { dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { handleTrusted } from './trust'
import { ui } from '../appLanguage'

export function registerDialogIpc(): void {
  handleTrusted('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ title: ui('dialog').chooseFolder, buttonLabel: ui('dialog').open, properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handleTrusted('dialog:saveFile', async (_, defaultName: string, content: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: String(defaultName || 'file'),
      buttonLabel: ui('dialog').save,
      filters: [{ name: ui('dialog').json, extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, String(content ?? ''), 'utf-8')
    return result.filePath
  })

  handleTrusted('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      buttonLabel: ui('dialog').open,
      filters: [{ name: ui('dialog').json, extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return readFileSync(result.filePaths[0], 'utf-8')
  })
}
