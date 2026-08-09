import { BrowserWindow, dialog, nativeTheme, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { loadConfig, saveConfig } from './config'
import { isAppStreaming, setAppStreaming, clearAllStreaming } from './streamingState'
import { killAllAgentShells } from './ipc/shell'

let mainWindow: BrowserWindow | null = null
let headlessWindow: BrowserWindow | null = null
let lastRendererCrashAt = 0
let crashStreak = 0
let crashStreakSince = 0

interface WindowState {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized?: boolean
}

function loadWindowState(): WindowState {
  try {
    const cfg = loadConfig() as { settings?: { windowState?: WindowState } }
    return cfg.settings?.windowState || {}
  } catch {
    return {}
  }
}

/** Saved bounds only count if they are sane and land on a connected display. */
function windowStateUsable(s: WindowState): boolean {
  const w = s.width
  const h = s.height
  if (typeof w !== 'number' || typeof h !== 'number') return false
  if (w < 480 || h < 400) return false
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    const x = typeof s.x === 'number' ? s.x : b.x
    const y = typeof s.y === 'number' ? s.y : b.y
    return x < b.x + b.width && x + w > b.x && y < b.y + b.height && y + h > b.y
  })
}

let stateSaveTimer: NodeJS.Timeout | null = null

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.getNormalBounds()
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized()
  }
  try {
    saveConfig({ settings: { windowState: state } })
  } catch {
    // Best-effort; a failed state write must not break the window.
  }
}

function scheduleStateSave(win: BrowserWindow): void {
  if (stateSaveTimer) clearTimeout(stateSaveTimer)
  stateSaveTimer = setTimeout(() => saveWindowState(win), 400)
}

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
  // "type": "module"; the sandboxed build emits index.cjs. Load whichever
  // exists so a stale path never silently disables window.api.
  return existsSync(join(__dirname, '../preload/index.mjs'))
    ? join(__dirname, '../preload/index.mjs')
    : existsSync(join(__dirname, '../preload/index.cjs'))
      ? join(__dirname, '../preload/index.cjs')
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
    // Orphaned agent shells / streaming flags would otherwise keep the app
    // "busy" and leave npm test etc. running after a renderer death.
    try {
      killAllAgentShells()
    } catch {
      /* ignore */
    }
    clearAllStreaming()
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
  // Unresponsive renderer: still kill side effects so Stop/quit is not stuck.
  win.webContents.on('unresponsive', () => {
    try {
      killAllAgentShells()
    } catch {
      /* ignore */
    }
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const savedState = loadWindowState()
  const useSaved = windowStateUsable(savedState)
  const win = new BrowserWindow({
    width: savedState.width || 1200,
    height: savedState.height || 800,
    x: useSaved ? savedState.x : undefined,
    y: useSaved ? savedState.y : undefined,
    minWidth: 480,
    minHeight: 600,
    show: false,
    backgroundColor: initialBackground(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: resolvePreload(),
      sandbox: true
    }
  })
  mainWindow = win
  if (useSaved && savedState.maximized === true) win.maximize()

  win.on('resize', () => scheduleStateSave(win))
  win.on('move', () => scheduleStateSave(win))

  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  // Closing the window while an agent turn is running would silently kill it;
  // ask before letting the renderer go away.
  win.on('close', (event) => {
    if (!isAppStreaming() || win.isDestroyed()) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'Pawn',
      message: 'A task is still running.',
      detail: 'Closing the window cancels the running task. Close anyway?',
      buttons: ['Cancel', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (choice === 0) {
      event.preventDefault()
    } else {
      // Don't ask again if the app quits mid-teardown.
      setAppStreaming(false)
    }
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
      sandbox: true
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
