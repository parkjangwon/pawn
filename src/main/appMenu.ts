/**
 * Application menu in the app language. Electron's default menu is English
 * and labels the app "Electron"; this one uses the real name, the standard
 * roles (so copy/paste, undo, zoom and window handling keep working), and
 * rebuilds whenever the language changes.
 */
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { ui } from './appLanguage'
import { getMainWindow } from './window'

const REPO = 'https://github.com/parkjangwon/pawn'

export function appMenuTemplate(isMac = process.platform === 'darwin'): MenuItemConstructorOptions[] {
  const m = ui('menu')
  const openSettings = (): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('app:shortcut', 'open-settings')
  }
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: 'Pawn',
          submenu: [
            { role: 'about', label: m.about },
            { type: 'separator' },
            { label: m.settings, accelerator: 'Cmd+,', click: openSettings },
            { type: 'separator' },
            { role: 'hide', label: m.hide },
            { role: 'hideOthers', label: m.hideOthers },
            { role: 'unhide', label: m.showAll },
            { type: 'separator' },
            { role: 'quit', label: m.quit }
          ]
        }
      ]
    : []
  return [
    ...appMenu,
    {
      label: m.edit,
      submenu: [
        { role: 'undo', label: m.undo },
        { role: 'redo', label: m.redo },
        { type: 'separator' },
        { role: 'cut', label: m.cut },
        { role: 'copy', label: m.copy },
        { role: 'paste', label: m.paste },
        { role: 'selectAll', label: m.selectAll }
      ]
    },
    {
      label: m.view,
      submenu: [
        { role: 'reload', label: m.reload },
        { role: 'toggleDevTools', label: m.devtools },
        { type: 'separator' },
        { role: 'resetZoom', label: m.resetZoom },
        { role: 'zoomIn', label: m.zoomIn },
        { role: 'zoomOut', label: m.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullscreen }
      ]
    },
    {
      label: m.window,
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: m.minimize },
        { role: 'zoom', label: m.zoom },
        ...(isMac ? ([{ type: 'separator' }, { role: 'front', label: m.front }] as MenuItemConstructorOptions[]) : [{ role: 'close', label: m.close } as MenuItemConstructorOptions])
      ]
    },
    {
      label: m.help,
      role: 'help',
      submenu: [{ label: m.docs, click: () => void shell.openExternal(REPO) }, ...(isMac ? [] : ([{ type: 'separator' }, { role: 'quit', label: m.quit }] as MenuItemConstructorOptions[]))]
    }
  ]
}

export function installAppMenu(): void {
  try {
    if (process.platform === 'darwin') app.setAboutPanelOptions({ applicationName: 'Pawn' })
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate()))
  } catch {
    /* headless / tests */
  }
}

export function rebuildAppMenu(): void {
  installAppMenu()
}
