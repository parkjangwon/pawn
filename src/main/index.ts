import { app, BrowserWindow, shell, ipcMain, dialog, Notification, desktopCapturer, systemPreferences } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- IPC Handlers ---

function registerIpc(): void {
  // Dialog
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // File System
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      writeFileSync(filePath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:listDir', async (_, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: join(dirPath, e.name)
      }))
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:stat', async (_, filePath: string) => {
    try {
      const s = statSync(filePath)
      return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
    try {
      mkdirSync(dirPath, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:delete', async (_, filePath: string) => {
    try {
      unlinkSync(filePath)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    return existsSync(filePath)
  })

  // Shell / Terminal
  ipcMain.handle('shell:exec', async (_, command: string, cwd?: string) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || undefined,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code || 1 }
    }
  })

  // Computer Use - Screenshot
  ipcMain.handle('computer:screenshot', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (sources.length === 0) return { error: 'No screen sources' }
      return { dataUrl: sources[0].thumbnail.toDataURL() }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Computer Use - Mouse/Keyboard (via shell commands, platform-specific)
  ipcMain.handle('computer:click', async (_, x: number, y: number) => {
    const cmd = process.platform === 'darwin'
      ? `cliclick c:${x},${y}`
      : process.platform === 'linux'
        ? `xdotool mousemove ${x} ${y} click 1`
        : ''
    if (!cmd) return { error: 'Unsupported platform' }
    try {
      await execAsync(cmd)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('computer:type', async (_, text: string) => {
    const cmd = process.platform === 'darwin'
      ? `cliclick t:"${text.replace(/"/g, '\\"')}"`
      : process.platform === 'linux'
        ? `xdotool type -- "${text.replace(/"/g, '\\"')}"`
        : ''
    if (!cmd) return { error: 'Unsupported platform' }
    try {
      await execAsync(cmd)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('computer:keypress', async (_, key: string) => {
    const cmd = process.platform === 'darwin'
      ? `cliclick kp:${key}`
      : process.platform === 'linux'
        ? `xdotool key ${key}`
        : ''
    if (!cmd) return { error: 'Unsupported platform' }
    try {
      await execAsync(cmd)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Browser Use - open URL in embedded browser or external
  ipcMain.handle('browser:open', async (_, url: string) => {
    await shell.openExternal(url)
    return { ok: true }
  })

  // Notifications
  ipcMain.handle('notification:send', async (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
    return { ok: true }
  })

  // Permission check
  ipcMain.handle('permission:checkAccessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(false)
    }
    return true // Linux/Windows don't have the same model
  })

  ipcMain.handle('permission:requestAccessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(true)
    }
    return true
  })

  // Scheduling
  const scheduledTasks: Map<string, NodeJS.Timeout> = new Map()

  ipcMain.handle('schedule:add', async (_, id: string, intervalMs: number, payload: unknown) => {
    if (scheduledTasks.has(id)) {
      clearInterval(scheduledTasks.get(id)!)
    }
    const timer = setInterval(() => {
      mainWindow?.webContents.send('schedule:tick', { id, payload })
    }, intervalMs)
    scheduledTasks.set(id, timer)
    return { ok: true }
  })

  ipcMain.handle('schedule:remove', async (_, id: string) => {
    const timer = scheduledTasks.get(id)
    if (timer) {
      clearInterval(timer)
      scheduledTasks.delete(id)
    }
    return { ok: true }
  })

  ipcMain.handle('schedule:list', async () => {
    return Array.from(scheduledTasks.keys())
  })
}

app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
