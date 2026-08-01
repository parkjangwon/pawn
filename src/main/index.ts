import { app, BrowserWindow, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { registerAllIpc } from './ipc'
import { createMainWindow } from './window'
import { killAllTerminals } from './ipc/terminal'
import { startRoutineServices, stopRoutineServices } from './ipc/routine'
import { initKeybindings, registerShortcutForwarding } from './ipc/keybindings'

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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https:;"
        ]
      }
    })
  })

  registerAllIpc()
  initKeybindings()
  startRoutineServices()

  app.on('will-quit', () => {
    killAllTerminals()
    stopRoutineServices()
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
