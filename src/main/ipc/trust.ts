import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { getMainWindow } from '../window'

/** Only the app's own main window may invoke privileged IPC. */
export function isTrustedSender(event: { sender: WebContents }): boolean {
  const win = getMainWindow()
  return win !== null && event.sender === win.webContents
}

/** ipcMain.handle wrapper that rejects calls from any untrusted webContents. */
export function handleTrusted(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) return { error: 'Untrusted sender' }
    return listener(event, ...args)
  })
}
