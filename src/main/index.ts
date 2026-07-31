import { app, BrowserWindow, WebContentsView, shell, ipcMain, dialog, Notification, desktopCapturer, systemPreferences, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { spawn, type IPty } from 'node-pty'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { loadConfig, saveConfig } from './config'
import { clampDim, pickShell } from './terminal'
import * as db from './db'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

let mainWindow: BrowserWindow | null = null
const terminals = new Map<string, IPty>()

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
      // electron-vite v6 emits the preload as index.mjs when package.json has
      // "type": "module"; older versions emit index.js. Load whichever exists
      // so a stale path never silently disables window.api.
      preload: (existsSync(join(__dirname, '../preload/index.mjs'))
        ? join(__dirname, '../preload/index.mjs')
        : join(__dirname, '../preload/index.js')),
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
      // Sort by path for deterministic output — filesystem order varies
      // between runs and causes unnecessary cache-prefix drift.
      results.sort((a, b) => a.path.localeCompare(b.path))
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

  ipcMain.handle('fs:homeDir', async () => {
    try {
      return app.getPath('home')
    } catch {
      return null
    }
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
  ipcMain.handle('db:deleteMessage', async (_, id) => { db.deleteMessage(id); return { ok: true } })
  ipcMain.handle('db:clearMessages', async (_, sessionId) => { db.clearMessages(sessionId); return { ok: true } })
  ipcMain.handle('db:getMessages', async (_, sessionId) => db.getMessagesBySession(sessionId))
  ipcMain.handle('db:getTranscript', async (_, sessionId) => db.getTranscript(sessionId))
  ipcMain.handle('db:saveTranscript', async (_, sessionId, json) => { db.saveTranscript(sessionId, json); return { ok: true } })
  ipcMain.handle('db:clearTranscript', async (_, sessionId) => { db.clearTranscript(sessionId); return { ok: true } })
  ipcMain.handle('db:addUsage', async (_, row) => { db.addUsage(row); return { ok: true } })
  ipcMain.handle('db:getUsageBySession', async (_, sessionId) => db.getUsageBySession(sessionId))
  ipcMain.handle('db:getUsageSummary', async (_, since) => db.getUsageSummary(since))

  // --- Browser (Embedded) ---
  registerBrowserIpc()

  // --- Terminal (PTY) ---
  registerTerminalIpc()
}

// The embedded browser runs in its own session partition. The app's own CSP is
// installed on `session.defaultSession`; sharing it would apply `default-src
// 'self'` to every website the agent visits and break all of them. A persistent
// partition also gives the agent a durable cookie jar, so a site the user logged
// into stays logged in across runs.
const BROWSER_PARTITION = 'persist:pawn-browser'
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

let browserView: WebContentsView | null = null
let browserVisible = false
const browserLogs: string[] = []

function emitBrowserEvent(payload: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('browser:event', payload)
  }
}

function browserState(): Record<string, unknown> {
  if (!browserView) return { created: false }
  const wc = browserView.webContents
  const nav = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean } }).navigationHistory
  return {
    created: true,
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: nav ? nav.canGoBack() : false,
    canGoForward: nav ? nav.canGoForward() : false,
    visible: browserVisible
  }
}

function ensureBrowserView(): WebContentsView {
  if (browserView && !browserView.webContents.isDestroyed()) return browserView

  browserView = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  const wc = browserView.webContents
  wc.setUserAgent(BROWSER_USER_AGENT)
  // Popups navigate the same view instead of spawning windows the agent cannot see.
  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url).catch(() => {})
    return { action: 'deny' }
  })
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = level === 2 ? 'warn' : level === 3 ? 'error' : 'info'
    browserLogs.push(`[${tag}] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`)
    if (browserLogs.length > 300) browserLogs.splice(0, browserLogs.length - 300)
  })
  wc.on('did-start-loading', () => emitBrowserEvent({ type: 'loading', ...browserState() }))
  wc.on('did-stop-loading', () => emitBrowserEvent({ type: 'loaded', ...browserState() }))
  wc.on('did-navigate', () => { browserLogs.length = 0; emitBrowserEvent({ type: 'navigated', ...browserState() }) })
  wc.on('did-navigate-in-page', () => emitBrowserEvent({ type: 'navigated', ...browserState() }))
  wc.on('page-title-updated', () => emitBrowserEvent({ type: 'title', ...browserState() }))
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 is a user/script-initiated abort
    emitBrowserEvent({ type: 'error', code, description: desc, url, ...browserState() })
  })

  if (mainWindow) {
    mainWindow.contentView.addChildView(browserView)
    // Parked off-screen until the panel positions it, so an agent-created page is
    // live and scriptable without flashing over the UI.
    browserView.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
    browserView.setVisible(false)
    browserVisible = false
  }
  return browserView
}

function requireView(): { view: WebContentsView } | { error: string } {
  if (!browserView || browserView.webContents.isDestroyed()) {
    return { error: 'Browser not created' }
  }
  if (!browserView.webContents.getURL()) {
    return { error: 'No page loaded. Call browser_navigate first.' }
  }
  return { view: browserView }
}

/** Run an expression in the page and normalise the failure into a value. */
async function runInPage<T>(code: string): Promise<T | { error: string }> {
  const guard = requireView()
  if ('error' in guard) return guard
  try {
    return (await guard.view.webContents.executeJavaScript(code, true)) as T
  } catch (err) {
    return { error: 'Page script failed: ' + String(err) }
  }
}

/** JS that resolves an element from a snapshot ref or a CSS selector. */
function resolverExpr(ref: string, selector: string): string {
  const r = JSON.stringify(ref || '')
  const s = JSON.stringify(selector || '')
  return `(function(){ var r=${r}, s=${s};
    if (r) { var byRef = document.querySelector('[data-pawn-ref="' + r.replace(/"/g,'') + '"]'); if (byRef) return byRef }
    if (s) { try { return document.querySelector(s) } catch (e) { return null } }
    return null })()`
}

function registerBrowserIpc(): void {
  ipcMain.handle('browser:ensure', async () => {
    try {
      ensureBrowserView()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:create', async () => {
    try {
      ensureBrowserView()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:destroy', async () => {
    try {
      if (browserView && mainWindow && !browserView.webContents.isDestroyed()) {
        mainWindow.contentView.removeChildView(browserView)
        browserView.webContents.close()
      }
      browserView = null
      browserVisible = false
      browserLogs.length = 0
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:setVisible', async (_, visible: boolean) => {
    if (!browserView || browserView.webContents.isDestroyed()) return { ok: true }
    browserView.setVisible(visible)
    browserVisible = visible
    return { ok: true }
  })

  ipcMain.handle('browser:bounds', async (_, x: number, y: number, width: number, height: number) => {
    if (!browserView || browserView.webContents.isDestroyed()) return { error: 'Browser not created' }
    browserView.setBounds({
      x: Math.round(x), y: Math.round(y),
      width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height))
    })
    return { ok: true }
  })

  ipcMain.handle('browser:state', async () => browserState())
  ipcMain.handle('browser:logs', async () => browserLogs.slice(-50))

  ipcMain.handle('browser:navigate', async (_, rawUrl: string) => {
    const view = ensureBrowserView()
    let url = String(rawUrl || '').trim()
    if (!url) return { error: 'Empty URL' }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url

    try {
      await view.webContents.loadURL(url)
    } catch (err) {
      const msg = String(err)
      // ERR_ABORTED fires on redirects and on pages that navigate during load;
      // the page is usually fine, so report the resulting URL rather than failing.
      if (!msg.includes('ERR_ABORTED')) return { error: `Failed to load ${url}: ${msg}` }
    }
    return { url: view.webContents.getURL(), title: view.webContents.getTitle() }
  })

  ipcMain.handle('browser:back', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    const wc = guard.view.webContents
    const nav = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; goBack(): void } }).navigationHistory
    if (!nav || !nav.canGoBack()) return { error: 'No previous page in history' }
    nav.goBack()
    await new Promise((r) => setTimeout(r, 400))
    return { url: wc.getURL() }
  })

  ipcMain.handle('browser:reload', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    guard.view.webContents.reload()
    return { ok: true }
  })

  ipcMain.handle('browser:eval', async (_, code: string) => {
    const result = await runInPage<unknown>(`(function(){ try { return { ok: (${code}) } } catch (e) { return { err: String(e) } } })()`)
    if (result && typeof result === 'object' && 'error' in (result as object)) return result
    const wrapped = result as { ok?: unknown; err?: string }
    if (wrapped?.err) return { error: wrapped.err }
    let serialized: string
    try {
      serialized = JSON.stringify(wrapped?.ok ?? null, null, 2) ?? 'undefined'
    } catch {
      serialized = String(wrapped?.ok)
    }
    return { result: serialized.slice(0, 8000) }
  })

  ipcMain.handle('browser:snapshot', async (_, filter: string) => {
    const f = JSON.stringify(String(filter || '').toLowerCase())
    return runInPage(`(function(){
      var FILTER = ${f};
      var SEL = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],[contenteditable=""],[contenteditable="true"]';
      var nodes = Array.prototype.slice.call(document.querySelectorAll(SEL));
      var out = [], used = {};
     for (var i = 0; i < nodes.length; i++) {
       var el = nodes[i];
       var rect = el.getBoundingClientRect();
       if (rect.width === 0 && rect.height === 0) continue;
       var st = window.getComputedStyle(el);
       if (st.visibility === 'hidden' || st.display === 'none') continue;
       if (el.disabled === true) continue;
        // Deterministic ref: hash the element's stable attributes so the same
        // element gets the same ref across snapshots. Sequential numbering (e1,
        // e2, …) invalidated every ref when a single element was inserted or
        // removed, which broke cache prefixes in the transcript.
        var sigParts = [
          el.tagName.toLowerCase(),
          el.getAttribute('role') || '',
          el.getAttribute('name') || '',
          el.getAttribute('id') || '',
          el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
          (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
        ].join('|');
        var hash = 0;
        for (var j = 0; j < sigParts.length; j++) {
          hash = ((hash << 5) - hash + sigParts.charCodeAt(j)) | 0;
        }
        var base = 'e' + Math.abs(hash);
        var ref = base;
        var suf = 1;
        while (used[ref]) { ref = base + '_' + suf; suf++; }
        used[ref] = true;
       el.setAttribute('data-pawn-ref', ref);
        var label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!label && el.labels && el.labels[0]) label = el.labels[0].innerText || '';
        var text = (el.innerText || label || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
        var isSecret = el.tagName === 'INPUT' && (el.type === 'password' || el.autocomplete === 'one-time-code');
        var item = {
          ref: ref,
          role: (el.getAttribute('role') || (el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''))),
          text: text,
          name: (el.getAttribute('name') || el.id || '').slice(0, 60),
          placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
          value: isSecret ? '' : String(el.value == null ? '' : el.value).slice(0, 60),
          href: el.tagName === 'A' ? String(el.getAttribute('href') || '').slice(0, 140) : ''
        };
        if (FILTER) {
          var hay = (item.text + ' ' + item.name + ' ' + item.placeholder + ' ' + item.href).toLowerCase();
          if (hay.indexOf(FILTER) === -1) continue;
        }
        out.push(item);
      }
      return { url: location.href, title: document.title, elements: out.slice(0, 150), truncated: out.length > 150 };
    })()`)
  })

  ipcMain.handle('browser:click', async (_, ref: string, selector: string) => {
    return runInPage(`(function(){
      var el = ${resolverExpr(ref, selector)};
      if (!el) return { error: 'No element matched. Take a fresh browser_snapshot — refs are invalidated by navigation.' };
      try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
      if (el.focus) { try { el.focus() } catch (e) {} }
      var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName).toString().replace(/\\s+/g,' ').trim().slice(0, 60);
      el.click();
      return { message: 'Clicked ' + JSON.stringify(label) + '. Take a new snapshot if the page changed.' };
    })()`)
  })

  ipcMain.handle('browser:fill', async (_, ref: string, selector: string, value: string, submit: boolean) => {
    const v = JSON.stringify(String(value ?? ''))
    const doSubmit = submit === true ? 'true' : 'false'
    return runInPage(`(function(){
      var el = ${resolverExpr(ref, selector)};
      if (!el) return { error: 'No element matched. Take a fresh browser_snapshot — refs are invalidated by navigation.' };
      var value = ${v};
      try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
      if (el.focus) { try { el.focus() } catch (e) {} }
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if ('value' in el) {
        // Assign through the prototype setter so React and other frameworks that
        // patch the value property still observe the change.
        var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        return { error: 'Element is not editable' };
      }
      if (${doSubmit}) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        if (el.form && el.form.requestSubmit) { try { el.form.requestSubmit() } catch (e) {} }
      }
      return { message: 'Filled ' + (el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName) + (${doSubmit} ? ' and submitted' : '') };
    })()`)
  })

  ipcMain.handle('browser:readText', async (_, selector: string) => {
    const s = JSON.stringify(String(selector || ''))
    return runInPage(`(function(){
      var s = ${s};
      var root = document.body;
      if (s) { try { root = document.querySelector(s) } catch (e) { root = null } }
      if (!root) return { error: 'No element matched selector ' + s };
      var text = (root.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      return { text: text.slice(0, 12000), truncated: text.length > 12000 };
    })()`)
  })

  ipcMain.handle('browser:screenshot', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    try {
      const image = await guard.view.webContents.capturePage()
      const dataUrl = image.toDataURL()
      return { dataUrl, bytes: dataUrl.length }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:devtools', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    guard.view.webContents.openDevTools({ mode: 'detach' })
    return { ok: true }
  })

  ipcMain.handle('browser:getURL', async () => {
    if (!browserView || browserView.webContents.isDestroyed()) return { error: 'Browser not created' }
    return { url: browserView.webContents.getURL() }
  })
}

function registerTerminalIpc(): void {
  function isTrustedSender(event: { sender: Electron.WebContents }): boolean {
    return mainWindow !== null && event.sender === mainWindow.webContents
  }

  function getPtyOrReply(event: Electron.IpcMainEvent, id: string): IPty | undefined {
    const pty = terminals.get(id)
    if (!pty) event.reply('terminal:data', id, '\r\nTerminal session not found\r\n')
    return pty
  }

  ipcMain.handle('terminal:create', (event, id, cols, rows, cwd) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return { ok: false, error: 'Invalid request' }
    const cwdStr = typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
    if (!existsSync(cwdStr)) return { ok: false, error: `Directory not found: ${cwdStr}` }

    const existing = terminals.get(id)
    if (existing) {
      try { existing.kill() } catch {}
      terminals.delete(id)
    }

    const shell = pickShell()
    let pty: IPty
    try {
      pty = spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: clampDim(cols, 80),
        rows: clampDim(rows, 24),
        cwd: cwdStr,
        env: { ...process.env, TERM: 'xterm-256color' }
      })
    } catch (err) {
      return { ok: false, error: String(err) }
    }

    terminals.set(id, pty)
    pty.onData((data) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        try { win.webContents.send('terminal:data', id, data) } catch {}
      }
    })
    pty.onExit(() => { terminals.delete(id) })
    return { ok: true }
  })

  ipcMain.on('terminal:write', (event, id, data) => {
    if (!isTrustedSender(event) || typeof id !== 'string' || typeof data !== 'string') return
    const pty = getPtyOrReply(event, id)
    if (!pty) return
    try { pty.write(data.slice(0, 1024 * 1024)) } catch {}
  })

  ipcMain.on('terminal:resize', (event, id, cols, rows) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return
    const pty = getPtyOrReply(event, id)
    if (!pty) return
    try { pty.resize(clampDim(cols, 80), clampDim(rows, 24)) } catch {}
  })

  ipcMain.on('terminal:dispose', (event, id) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return
    const pty = terminals.get(id)
    if (pty) {
      try { pty.kill() } catch {}
      terminals.delete(id)
    }
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

  app.on('will-quit', () => {
    terminals.forEach((pty) => {
      try { pty.kill() } catch {}
    })
    terminals.clear()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
