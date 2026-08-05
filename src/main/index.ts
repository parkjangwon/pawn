import { app, BrowserWindow, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { registerAllIpc } from './ipc'
import { createMainWindow, getMainWindow } from './window'
import { killAllTerminals } from './ipc/terminal'
import { killAllMcpServers } from './mcpManager'
import { startRoutineServices, stopRoutineServices } from './ipc/routine'
import { initKeybindings, registerShortcutForwarding } from './ipc/keybindings'
import { closeDb } from './db'
import { createTray, destroyTray, trayEnabled } from './tray'
import { forceAllowQuit, registerQuitConfirm } from './quit'
import { closeMemoryDb } from './memory'

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

// Two instances would open the same SQLite database from separate processes,
// which can corrupt the WAL; focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  forceAllowQuit()
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

// Must be registered before any webContents is created so every view
// (main window, embedded browser, DevTools) forwards shortcuts to the app.
registerShortcutForwarding()

app.whenReady().then(() => {
  // CSP for security
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // In dev mode, allow Vite dev server (localhost:5173)
    if (is.dev) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:* ws://localhost:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; style-src 'self' 'unsafe-inline' http://localhost:*; img-src 'self' data: blob: http://localhost:*; font-src 'self' http://localhost:*; connect-src 'self' https: http://localhost:* ws://localhost:*;"
          ]
        }
      })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*;"
        ]
      }
    })
  })

  registerAllIpc()
  initKeybindings()
  registerQuitConfirm()
  startRoutineServices()

  app.on('will-quit', () => {
    killAllTerminals()
    // Unlike terminals, MCP servers are a shared background capability a
    // headless routine run may still depend on — only torn down at quit,
    // not when the main window closes.
    killAllMcpServers()
    stopRoutineServices()
    destroyTray()
    closeMemoryDb()
    closeDb()
  })

  const createWindow = (): void => {
    const win = createMainWindow()
    // A closed window leaves no UI for its PTYs; kill them so no orphan shell
    // keeps running until the app quits.
    win.on('closed', () => killAllTerminals())
  }

  createWindow()
  if (trayEnabled()) createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Keep the app alive on Windows/Linux while the tray is enabled, so the
  // tray icon is not destroyed the moment the last window closes.
  if (process.platform !== 'darwin' && !trayEnabled()) app.quit()
})
}
