import { app, BrowserWindow, dialog, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { registerAllIpc } from './ipc'
import { disposeLsp } from './ipc/lsp'
import { disposeAgentRuntime } from './ipc/agentRuntime'
import { disposeKiro } from './ipc/kiro'
import { disposeXai } from './ipc/xai'
import { disposeChatGpt } from './ipc/chatgpt'
import { disposeClaudeOauth } from './ipc/claudeOauth'
import { disposeAntigravity } from './ipc/antigravity'
import { disposeComputer } from './computer/service'
import { disposeRecorder } from './ipc/recorder'
import { disposeTelegram } from './ipc/telegram'
import { createMainWindow, getMainWindow } from './window'
import { killAllTerminals } from './ipc/terminal'
import { killAllMcpServers } from './mcpManager'
import { startRoutineServices, stopRoutineServices } from './ipc/routine'
import { initKeybindings, registerShortcutForwarding } from './ipc/keybindings'
import { closeDb } from './db'
import { createTray, destroyTray, trayEnabled } from './tray'
import { forceAllowQuit, registerQuitConfirm } from './quit'
import { installAppMenu } from './appMenu'
import { setAppLanguage } from './appLanguage'
import { loadConfig } from './config'
import { DEV_CSP, PROD_CSP } from './csp'

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
  try {
    boot()
  } catch (err) {
    // A broken store must never leave a zombie process with no window and no
    // teardown handlers: surface it and quit.
    console.error('[pawn] boot failed:', err)
    dialog.showErrorBox('Pawn failed to start', err instanceof Error ? err.message : String(err))
    app.quit()
  }
})

const boot = (): void => {
  // CSP for security
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // In dev mode, allow Vite dev server (localhost:5173)
    if (is.dev) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEV_CSP]
        }
      })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // No remote img-src: a markdown image URL is a zero-click exfil channel.
        'Content-Security-Policy': [PROD_CSP]
      }
    })
  })

  // Native UI language before the renderer reports in: saved setting, else the OS.
  try {
    setAppLanguage((loadConfig() as { settings?: { language?: string } }).settings?.language || app.getLocale())
  } catch {
    setAppLanguage(app.getLocale())
  }
  installAppMenu()
  registerAllIpc()
  initKeybindings()
  registerQuitConfirm()
  try {
    startRoutineServices()
  } catch (err) {
    // A corrupt or locked store must degrade (no automations), not kill boot.
    console.error('[pawn] routine services failed to start:', err)
  }

  app.on('will-quit', () => {
    killAllTerminals()
    // Unlike terminals, MCP servers are a shared background capability a
    // headless routine run may still depend on — only torn down at quit,
    // not when the main window closes.
    killAllMcpServers()
    void disposeLsp().catch(() => {})
    void disposeAgentRuntime()
    disposeKiro()
    disposeXai()
    disposeChatGpt()
    disposeClaudeOauth()
    disposeAntigravity()
    disposeComputer()
    void disposeTelegram()
    stopRoutineServices()
    destroyTray()
    closeDb()
  })

  const createWindow = (): void => {
    const win = createMainWindow()
    // A closed window leaves no UI for its PTYs; kill them so no orphan shell
    // keeps running until the app quits.
    win.on('closed', () => {
      killAllTerminals()
      // Nobody is left to draft the recording: drop it.
      disposeRecorder()
    })
  }

  createWindow()
  if (trayEnabled()) createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  // Keep the app alive on Windows/Linux while the tray is enabled, so the
  // tray icon is not destroyed the moment the last window closes.
  if (process.platform !== 'darwin' && !trayEnabled()) app.quit()
})
}
