import { ipcMain, Notification, shell, systemPreferences } from 'electron'
import { getMainWindow } from '../window'

// Recurring timers created by the renderer; the main process owns them so they
// survive renderer reloads and keep ticking while the window is hidden.
const scheduledTasks: Map<string, NodeJS.Timeout> = new Map()

export function registerMiscIpc(): void {
  ipcMain.handle('browser:open', async (_, url: string) => {
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('notification:send', async (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
    return { ok: true }
  })

  ipcMain.handle('permission:checkAccessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(false)
    }
    return true // Linux/Windows don't have the same model
  })

  ipcMain.handle('permission:requestAccessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(true)
    }
    return true
  })

  ipcMain.handle('schedule:add', async (_, id: string, intervalMs: number, payload: unknown) => {
    if (scheduledTasks.has(id)) {
      clearInterval(scheduledTasks.get(id)!)
    }
    const timer = setInterval(() => {
      getMainWindow()?.webContents.send('schedule:tick', { id, payload })
    }, intervalMs)
    scheduledTasks.set(id, timer)
    return { ok: true }
  })

  ipcMain.handle('schedule:remove', async (_, id: string) => {
    const timer = scheduledTasks.get(id)
    if (timer) {
      clearInterval(timer)
      scheduledTasks.delete(id)
    }
    return { ok: true }
  })

  ipcMain.handle('schedule:list', async () => {
    return Array.from(scheduledTasks.keys())
  })
}
