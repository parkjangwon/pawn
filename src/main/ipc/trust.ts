import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { getHeadlessWindow, getMainWindow } from '../window'

/** Only the app's own main window (or the hidden routine runner) may invoke privileged IPC. */
export function isTrustedSender(event: { sender: WebContents }): boolean {
  const win = getMainWindow()
  if (win && event.sender === win.webContents) return true
  const hw = getHeadlessWindow()
  return hw !== null && event.sender === hw.webContents
}

/** ipcMain.handle wrapper that rejects calls from any untrusted webContents. */
export function handleTrusted(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) return { error: 'Untrusted sender' }
    try {
      return await listener(event, ...args)
    } catch (err) {
      // Never let an unhandled throw take down the main process IPC pipeline.
      console.error(`[ipc] ${channel} failed:`, err)
      return {
        error: err instanceof Error ? err.message : String(err),
        ok: false
      }
    }
  })
}
