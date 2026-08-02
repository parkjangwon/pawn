import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { loadConfig } from './config'

let mainWindow: BrowserWindow | null = null
let headlessWindow: BrowserWindow | null = null
let lastRendererCrashAt = 0
let crashStreak = 0
let crashStreakSince = 0

/** Match the renderer theme on startup so there is no white/dark flash. */
function initialBackground(): string {
  try {
    const cfg = loadConfig() as { settings?: { theme?: string } }
    const theme = cfg.settings?.theme || 'system'
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
    return dark ? '#212121' : '#ffffff'
  } catch {
    return '#212121'
  }
}

function resolvePreload(): string {
  // electron-vite v6 emits the preload as index.mjs when package.json has
  // "type": "module"; older versions emit index.js. Load whichever exists
  // so a stale path never silently disables window.api.
  return existsSync(join(__dirname, '../preload/index.mjs'))
    ? join(__dirname, '../preload/index.mjs')
    : join(__dirname, '../preload/index.js')
}

function loadRenderer(win: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']).catch(() => {})
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')).catch(() => {})
  }
}

/** Reload after a renderer crash, at most once per 10s to avoid a crash loop. */
function attachRecovery(win: BrowserWindow, onClosed: () => void): void {
  win.on('closed', onClosed)
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    const now = Date.now()
    // Stop auto-reloading after repeated crashes so a broken renderer cannot
    // spin in an endless reload loop.
    if (now - crashStreakSince > 60_000) {
      crashStreak = 0
      crashStreakSince = now
    }
    crashStreak++
    if (crashStreak > 3) return
    if (now - lastRendererCrashAt < 10_000) return
    lastRendererCrashAt = now
    win.webContents.reload()
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    show: false,
    backgroundColor: initialBackground(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  attachRecovery(win, () => {
    if (mainWindow === win) mainWindow = null
  })
  loadRenderer(win)

  return win
}

/**
 * Hidden renderer that runs routines when every window is closed. It exists
 * only while a headless run is in flight; the routine IPC layer creates and
 * closes it (see ipc/routine.ts).
 */
export function ensureHeadlessWindow(): BrowserWindow {
  if (headlessWindow && !headlessWindow.isDestroyed()) return headlessWindow
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    backgroundColor: initialBackground(),
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false
    }
  })
  headlessWindow = win
  attachRecovery(win, () => {
    if (headlessWindow === win) headlessWindow = null
  })
  loadRenderer(win)
  return win
}

export function getHeadlessWindow(): BrowserWindow | null {
  return headlessWindow && !headlessWindow.isDestroyed() ? headlessWindow : null
}

export function closeHeadlessWindow(): void {
  if (headlessWindow && !headlessWindow.isDestroyed()) headlessWindow.destroy()
  headlessWindow = null
}
