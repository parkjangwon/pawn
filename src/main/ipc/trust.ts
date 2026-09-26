import { ipcMain, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron'
import { getHeadlessWindow, getMainWindow, isAppUrl } from '../window'

/**
 * Only the app's own main window (or the hidden routine runner) may invoke
 * privileged IPC, and only from its top-level frame while it is showing the
 * app document. Matching webContents alone is not enough: a navigated window
 * or a child frame would inherit the same sender.
 */
export function isTrustedSender(event: {
  sender: WebContents
  senderFrame?: WebFrameMain | null
}): boolean {
  const win = getMainWindow()
  const hw = getHeadlessWindow()
  const owned =
    (win !== null && event.sender === win.webContents) ||
    (hw !== null && event.sender === hw.webContents)
  if (!owned) return false
  let frame: WebFrameMain | null | undefined
  try {
    frame = event.senderFrame
  } catch {
    // Accessing a disposed frame throws; treat it as untrusted.
    return false
  }
  if (!frame) return false
  // Compare by ids, not object identity: WebFrameMain wrappers are not guaranteed stable.
  const main = event.sender.mainFrame
  if (frame.parent !== null) return false
  if (frame.processId !== main.processId || frame.routingId !== main.routingId) return false
  return isAppUrl(frame.url)
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
