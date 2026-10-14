import { Tray, Menu, nativeImage, app, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { getMainWindow, createMainWindow } from './window'
import { loadConfig, saveConfig } from './config'
import { trayMenuSpec } from './trayLabels'
import { setAppLanguage } from './appLanguage'

// Fallback only: 18x18 monochrome pawn silhouette (template image adapts to
// light/dark menus). The shipped logo in resources/icon.png is preferred.
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAMklEQVR4nGNgGNHgPxKmiiFkG4bNELIMo5pBuAwjG1DFkGFs0DBNR1QxCJ8GqsQgTgAA73NEvJQmHWAAAAAASUVORK5CYII='

let tray: Tray | null = null

function openWindow(): void {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  createMainWindow()
}

export function trayEnabled(): boolean {
  try {
    const cfg = loadConfig() as { settings?: { trayEnabled?: boolean } }
    return cfg.settings?.trayEnabled !== false
  } catch {
    return true
  }
}

export function setTrayEnabled(enabled: boolean): void {
  saveConfig({ settings: { trayEnabled: enabled === true } })
  if (enabled === true) createTray()
  else destroyTray()
}

/** Record & Replay hooks, set by the recorder IPC (macOS only). */
let recordActions: { recording: () => boolean; start: () => void; stop: () => void } | null = null

export function setTrayRecordActions(actions: typeof recordActions): void {
  recordActions = actions
  refreshTrayMenu()
}

export function refreshTrayMenu(): void {
  if (tray) tray.setContextMenu(buildMenu())
}

function buildMenu(): Menu {
  // Always English: the menu bar menu ignores the app language and OS locale.
  const rec = process.platform === 'darwin' && recordActions ? recordActions : null
  const spec = trayMenuSpec({ isWin: process.platform === 'win32', canRecord: !!rec, recording: rec?.recording() === true })
  const template: MenuItemConstructorOptions[] = spec.map((item) => {
    switch (item.id) {
      case 'separator':
        return { type: 'separator' }
      case 'show':
        return { label: item.label, type: 'checkbox', checked: true, click: (mi) => setTrayEnabled(mi.checked) }
      case 'open':
        return { label: item.label, click: () => openWindow() }
      case 'record':
        return { label: item.label, click: () => rec?.start() }
      case 'stop':
        return { label: item.label, click: () => rec?.stop() }
      case 'quit':
        return { label: item.label, click: () => app.quit() }
    }
  })
  return Menu.buildFromTemplate(template)
}

/** Rebuild the tray menu after the app language changed. */
export function setTrayLanguage(lang: string): void {
  setAppLanguage(lang)
  if (!tray) return
  tray.setContextMenu(buildMenu())
}

export function createTray(): void {
  if (tray || (process.platform !== 'darwin' && process.platform !== 'win32')) return
  const size = process.platform === 'win32' ? 16 : 18
  const logo = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  const image = logo.isEmpty()
    ? nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`)
    : logo.resize({ width: size, height: size, quality: 'good' })
  tray = new Tray(image)
  tray.setToolTip('Pawn')

  // macOS/Windows: both left and right clicks open the menu; "Open Pawn" is
  // inside it. With a context menu set, left-click no longer opens the window
  // directly.
  tray.setContextMenu(buildMenu())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
