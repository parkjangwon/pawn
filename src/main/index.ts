import { app, BrowserWindow, WebContentsView, shell, ipcMain, dialog, Notification, desktopCapturer, systemPreferences, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { loadConfig, saveConfig } from './config'
import * as db from './db'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
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

  ipcMain.handle('fs:walk', async (_, rootPath: string) => {
    const IGNORE = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', 'coverage', '.turbo', '.cache'])
    const results: Array<{ name: string; path: string; isDirectory: boolean }> = []
    const MAX = 3000
    const walk = (dir: string, depth: number): void => {
      if (depth > 6 || results.length >= MAX) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (results.length >= MAX) return
        if (e.name.startsWith('.')) continue
        if (IGNORE.has(e.name)) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          walk(full, depth + 1)
        } else {
          results.push({ name: e.name, path: full, isDirectory: false })
        }
      }
    }
    try {
      walk(rootPath, 0)
      return results
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

  // Computer Use - Mouse/Keyboard (via platform-specific tools)
  ipcMain.handle('computer:click', async (_, x: number, y: number) => {
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('cliclick', [`c:${x},${y}`])
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['mousemove', String(x), String(y), 'click', '1'])
      } else {
        return { error: 'Unsupported platform' }
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('computer:type', async (_, text: string) => {
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('cliclick', [`t:${text}`])
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['type', '--', text])
      } else {
        return { error: 'Unsupported platform' }
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('computer:keypress', async (_, key: string) => {
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('cliclick', [`kp:${key}`])
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['key', key])
      } else {
        return { error: 'Unsupported platform' }
      }
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

  // --- Config (TOML) ---
  ipcMain.handle('config:load', async () => loadConfig())
  ipcMain.handle('config:save', async (_, config) => { saveConfig(config); return { ok: true } })

  // --- Database (SQLite) ---
  ipcMain.handle('db:loadAll', async () => db.loadFullState())
  ipcMain.handle('db:addProject', async (_, id, name, path) => { db.addProject(id, name, path); return { ok: true } })
  ipcMain.handle('db:updateProjectName', async (_, id, name) => { db.updateProjectName(id, name); return { ok: true } })
  ipcMain.handle('db:updateProjectPaths', async (_, id, paths) => { db.updateProjectPaths(id, paths); return { ok: true } })
  ipcMain.handle('db:removeProject', async (_, id) => { db.removeProject(id); return { ok: true } })
  ipcMain.handle('db:addSession', async (_, id, projectId, title, path) => { db.addSession(id, projectId, title, path); return { ok: true } })
  ipcMain.handle('db:updateSessionTitle', async (_, id, title) => { db.updateSessionTitle(id, title); return { ok: true } })
  ipcMain.handle('db:updateSessionPath', async (_, id, path) => { db.updateSessionPath(id, path); return { ok: true } })
  ipcMain.handle('db:removeSession', async (_, id) => { db.removeSession(id); return { ok: true } })
  ipcMain.handle('db:addMessage', async (_, id, sessionId, role, content) => { db.addMessage(id, sessionId, role, content); return { ok: true } })
  ipcMain.handle('db:updateMessageContent', async (_, id, content) => { db.updateMessageContent(id, content); return { ok: true } })
  ipcMain.handle('db:clearMessages', async (_, sessionId) => { db.clearMessages(sessionId); return { ok: true } })
  ipcMain.handle('db:getMessages', async (_, sessionId) => db.getMessagesBySession(sessionId))

  // --- Browser (Embedded) ---
  let browserView: WebContentsView | null = null
  let browserViewVisible = false

  ipcMain.handle('browser:create', async () => {
    if (browserView) return { ok: true }
    try {
      browserView = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
      if (mainWindow) {
        mainWindow.contentView.addChildView(browserView)
        // Default bounds matching right panel area (will be updated by renderer)
        const bounds = mainWindow.getBounds()
        browserView.setBounds({
          x: bounds.width - 320, y: 60,
          width: 320, height: bounds.height - 60
        })
        browserViewVisible = true
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:destroy', async () => {
    try {
      if (browserView && mainWindow) {
        mainWindow.contentView.removeChildView(browserView)
        browserView.webContents.close()
        browserView = null
        browserViewVisible = false
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:navigate', async (_, url: string) => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      await browserView.webContents.loadURL(url)
      return { ok: true }
    } catch (err) {
      // If navigation fails, try with https
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        try {
          await browserView.webContents.loadURL('https://' + url)
          return { ok: true }
        } catch (e) {
          return { error: String(e) }
        }
      }
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:eval', async (_, code: string) => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      const result = await browserView.webContents.executeJavaScript(code)
      return { result: JSON.stringify(result) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:screenshot', async () => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      const image = await browserView.webContents.capturePage()
      return { dataUrl: image.toDataURL() }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:devtools', async () => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      browserView.webContents.openDevTools({ mode: 'detach' })
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:bounds', async (_, x: number, y: number, width: number, height: number) => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      browserView.setBounds({ x, y, width, height })
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:reload', async () => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      browserView.webContents.reload()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:goBack', async () => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      if (browserView.webContents.canGoBack()) browserView.webContents.goBack()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:goForward', async () => {
    if (!browserView) return { error: 'Browser not created' }
    try {
      if (browserView.webContents.canGoForward()) browserView.webContents.goForward()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:getURL', async () => {
    if (!browserView) return { error: 'Browser not created' }
    return { url: browserView.webContents.getURL() }
  })
}

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

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
