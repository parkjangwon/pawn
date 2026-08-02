import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { getMainWindow, createMainWindow } from './window'
import { loadConfig, saveConfig } from './config'
import { menuLabels } from './trayLabels'

// Fallback only: 18x18 monochrome pawn silhouette (template image adapts to
// light/dark menus). The shipped logo in resources/icon.png is preferred.
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAMklEQVR4nGNgGNHgPxKmiiFkG4bNELIMo5pBuAwjG1DFkGFs0DBNR1QxCJ8GqsQgTgAA73NEvJQmHWAAAAAASUVORK5CYII='

let tray: Tray | null = null
let currentLang = 'en'

function labels(): { show: string; open: string; quit: string } {
  return menuLabels(currentLang, process.platform === 'win32')
}

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

function buildMenu(): Menu {
  const l = labels()
  return Menu.buildFromTemplate([
    { label: l.show, type: 'checkbox', checked: true, click: (item) => setTrayEnabled(item.checked) },
    { type: 'separator' },
    { label: l.open, click: () => openWindow() },
    { label: l.quit, click: () => app.quit() }
  ])
}

/** Update the tray menu language live when the renderer changes its language. */
export function setTrayLanguage(lang: string): void {
  currentLang = lang === 'ko' || lang === 'ja' || lang === 'zh' ? lang : 'en'
  if (!tray) return
  tray.setContextMenu(buildMenu())
}

export function createTray(): void {
  if (tray || (process.platform !== 'darwin' && process.platform !== 'win32')) return
  try {
    const lang = (loadConfig() as { settings?: { language?: string } }).settings?.language
    if (lang) currentLang = lang
  } catch { /* defaults */ }
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
