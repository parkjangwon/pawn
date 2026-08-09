import { Notification, app, ipcMain, shell, systemPreferences } from 'electron'
import { spawn, execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { resolve, sep, join } from 'path'
import { readFile, readdir } from 'fs/promises'
import { handleTrusted, isTrustedSender } from './trust'
import { setTrayEnabled, setTrayLanguage, trayEnabled } from '../tray'
import { setAppStreaming, setSessionStreaming, clearAllStreaming } from '../streamingState'
import { getPawnDir } from '../config'
import { getMainWindow } from '../window'
import { isConfirmQuitEnabled, setConfirmQuitEnabled } from '../quit'

const execFileAsync = promisify(execFileCb)

/** Simple semver compare: 1 if a>b, -1 if a<b, 0 if equal/unknown. */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/[^0-9.]/g, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/[^0-9.]/g, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

async function zipDirectory(srcDir: string, outZip: string): Promise<void> {
  // Prefer system zip for portability (no extra dep).
  await execFileAsync('zip', ['-r', '-q', outZip, '.'], {
    cwd: srcDir,
    maxBuffer: 64 * 1024 * 1024
  })
}

/** Modern (10.7+) ICNS chunk types that embed a PNG directly, smallest-first
 *  — a menu-row icon never needs more than ~64-128px, and skipping the large
 *  ic09/ic10/ic14 (512-1024px) variants keeps the payload small. */
const ICNS_PNG_TYPES = ['ic11', 'ic07', 'ic12', 'ic08', 'ic13', 'ic09', 'ic10', 'ic14']

/** Most apps ship exactly one primary icon in Contents/Resources; a name
 *  matching this pattern is preferred if there happen to be several
 *  (e.g. extra icons for document types), otherwise take the first found. */
async function findAppIcnsPath(appBundlePath: string): Promise<string | null> {
  const resourcesDir = join(appBundlePath, 'Contents', 'Resources')
  const entries = await readdir(resourcesDir).catch(() => [] as string[])
  const icnsFiles = entries.filter((f) => f.toLowerCase().endsWith('.icns'))
  if (icnsFiles.length === 0) return null
  const preferred = icnsFiles.find((f) => /^(icon|app|appicon)\.icns$/i.test(f))
  return join(resourcesDir, preferred || icnsFiles[0])
}

/** ICNS is a sequence of [4-byte type][4-byte big-endian length incl. header]
 *  [data] chunks after an 8-byte "icns" + total-length header. Extract
 *  whichever PNG-format chunk we prefer instead of pulling in a full ICNS
 *  parsing library for this one read-only lookup. */
async function extractIcnsPng(icnsPath: string): Promise<Buffer | null> {
  const buf = await readFile(icnsPath)
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'icns') return null
  const chunks = new Map<string, Buffer>()
  let offset = 8
  while (offset + 8 <= buf.length) {
    const type = buf.toString('ascii', offset, offset + 4)
    const length = buf.readUInt32BE(offset + 4)
    if (length < 8 || offset + length > buf.length) break
    chunks.set(type, buf.subarray(offset + 8, offset + length))
    offset += length
  }
  for (const type of ICNS_PNG_TYPES) {
    const data = chunks.get(type)
    if (data && data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return Buffer.from(data)
    }
  }
  return null
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

function safeExternalUrl(rawUrl: string): string | null {
  const url = String(rawUrl || '').trim()
  if (!url) return null
  if (!SCHEME_RE.test(url)) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** POSIX single-quote a value so it can never break out of a shell word. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** AppleScript string-literal escape; the POSIX-quoted text has no quotes. */
function appleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function registerMiscIpc(): void {
  // Accept either a boolean (legacy) or { sessionId, streaming } for multi-session.
  ipcMain.on('app:streaming', (event, payload: unknown) => {
    if (!isTrustedSender(event)) return
    if (typeof payload === 'boolean') {
      setAppStreaming(payload)
      return
    }
    if (payload && typeof payload === 'object') {
      const p = payload as { sessionId?: string; streaming?: boolean }
      if (typeof p.sessionId === 'string' && typeof p.streaming === 'boolean') {
        setSessionStreaming(p.sessionId, p.streaming)
        return
      }
    }
  })

  /** Renderer crash / hard stop: clear streaming flags (shells killed separately). */
  handleTrusted('app:clearStreaming', async () => {
    clearAllStreaming()
    return { ok: true }
  })

  handleTrusted('app:getVersion', async () => app.getVersion())

  /**
   * Compare local app version with GitHub Releases latest tag.
   * Network best-effort; never throws to the renderer.
   */
  handleTrusted('app:checkForUpdates', async () => {
    const current = app.getVersion()
    try {
      const res = await fetch(
        'https://api.github.com/repos/parkjangwon/pawn/releases/latest',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Pawn/${current}`
          }
        }
      )
      if (!res.ok) {
        return {
          current,
          updateAvailable: false,
          error: `GitHub API ${res.status}`
        }
      }
      const data = (await res.json()) as {
        tag_name?: string
        html_url?: string
        name?: string
      }
      const latest = String(data.tag_name || '')
        .replace(/^v/i, '')
        .trim()
      if (!latest) {
        return { current, updateAvailable: false, error: 'No release tag' }
      }
      const updateAvailable = compareSemver(latest, current) > 0
      return {
        current,
        latest,
        updateAvailable,
        releaseUrl: data.html_url || 'https://github.com/parkjangwon/pawn/releases/latest',
        releaseName: data.name || latest
      }
    } catch (e) {
      return { current, updateAvailable: false, error: String(e) }
    }
  })

  /** Zip a portable backup of ~/.pawn (config, db, memory — no attempt to encrypt). */
  handleTrusted('app:exportBackup', async () => {
    try {
      const pawnDir = getPawnDir()
      const { dialog } = await import('electron')
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      const defaultName = `pawn-backup-${stamp}.zip`
      const win = getMainWindow()
      const save = win
        ? await dialog.showSaveDialog(win, {
            defaultPath: defaultName,
            filters: [{ name: 'Zip', extensions: ['zip'] }]
          })
        : await dialog.showSaveDialog({
            defaultPath: defaultName,
            filters: [{ name: 'Zip', extensions: ['zip'] }]
          })
      if (save.canceled || !save.filePath) return { ok: false, cancelled: true }
      const outPath = save.filePath.endsWith('.zip') ? save.filePath : `${save.filePath}.zip`
      await zipDirectory(pawnDir, outPath)
      return { ok: true, path: outPath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  /** Close the main window only (macOS dock app stays alive). Used by progressive Cmd+W. */
  handleTrusted('window:close', async () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.close()
    return { ok: true }
  })

  handleTrusted('prefs:getConfirmQuit', async () => isConfirmQuitEnabled())

  handleTrusted('prefs:setConfirmQuit', async (_, enabled: boolean) => {
    setConfirmQuitEnabled(enabled === true)
    return { ok: true, confirmQuit: isConfirmQuitEnabled() }
  })

  handleTrusted('tray:getEnabled', async () => trayEnabled())
  handleTrusted('tray:setEnabled', async (_, enabled: boolean) => {
    setTrayEnabled(enabled === true)
    return { ok: true }
  })
  handleTrusted('tray:setLanguage', async (_, lang: string) => {
    setTrayLanguage(String(lang || ''))
    return { ok: true }
  })

  handleTrusted('browser:open', async (_, url: string) => {
    const target = safeExternalUrl(url)
    if (!target) return { error: 'Only http:// and https:// URLs can be opened externally' }
    await shell.openExternal(target)
    return { ok: true }
  })

  handleTrusted('notification:send', async (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body })
      notification.on('click', () => {
        const win = getMainWindow()
        if (!win || win.isDestroyed()) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      })
      notification.show()
    }
    return { ok: true }
  })

  handleTrusted('permission:checkAccessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(false)
    }
    return true // Linux/Windows don't have the same model
  })

  handleTrusted('permission:requestAccessibility', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.isTrustedAccessibilityClient(true)
    }
    return true
  })

  handleTrusted('workspace:openIn', async (_, path: string, appName: string) => {
    if (!path || !path.trim()) return { error: 'No path provided' }
    const target = (appName || '').trim().toLowerCase()
    if (target === 'finder' || target === '') {
      const err = await shell.openPath(path)
      return err ? { error: err } : { ok: true }
    }

    if (process.platform === 'darwin') {
      const child = spawn('open', ['-a', appName, path], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true }
    }

    const err = await shell.openPath(path)
    return err ? { error: err } : { ok: true }
  })

  // Reveal a file in the OS file manager (Finder / Explorer). Unlike openIn,
  // this selects the item in its parent folder instead of opening the file.
  handleTrusted('workspace:reveal', async (_, path: string) => {
    if (typeof path !== 'string' || !path.trim()) return { error: 'No path provided' }
    shell.showItemInFolder(resolve(String(path).trim()))
    return { ok: true }
  })

  // Open a Pawn-managed path (config file, data dir) with the OS default app.
  // Anything outside ~/.pawn is rejected so this cannot be used to launch
  // arbitrary files from renderer-controlled input.
  handleTrusted('app:openPath', async (_, path: string) => {
    if (typeof path !== 'string' || !path.trim()) return { error: 'Invalid path' }
    const pawnDir = getPawnDir()
    const resolved = resolve(String(path).trim())
    if (resolved !== pawnDir && !resolved.startsWith(pawnDir + sep)) {
      return { error: 'Path outside Pawn data directory' }
    }
    const err = await shell.openPath(resolved)
    return err ? { error: err } : { ok: true }
  })

  // Icon for the "open in" menu's app list. Read-only (just a bitmap for
  // display), so no path restriction like app:openPath's pawn-dir check.
  //
  // Reads the bundle's own .icns directly rather than calling
  // app.getFileIcon() — that API has a real Electron/Chromium bug where only
  // the very first call in a process's lifetime returns the correct icon;
  // every call after that (regardless of path, regardless of concurrency)
  // comes back as the same generic/corrupted bitmap. Since this menu always
  // needs several distinct icons, the API is unusable here.
  handleTrusted('app:getFileIcon', async (_, path: string) => {
    if (typeof path !== 'string' || !path.trim()) return { error: 'Invalid path' }
    if (path.endsWith('.app')) {
      try {
        const icnsPath = await findAppIcnsPath(path)
        const png = icnsPath ? await extractIcnsPng(icnsPath) : null
        if (png) return { dataUrl: `data:image/png;base64,${png.toString('base64')}` }
      } catch { /* fall through to the generic lookup below */ }
    }
    try {
      const icon = await app.getFileIcon(path, { size: 'normal' })
      return { dataUrl: icon.toDataURL() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  handleTrusted('workspace:runScript', async (_, cwd: string, script: string, packageManager: string) => {
    if (!cwd || !script) return { error: 'cwd and script are required' }
    const pmRaw = packageManager && packageManager.trim() ? packageManager.trim() : 'npm'
    // The package manager is used as an executable name; only accept plain
    // names (optionally scoped/versioned) so it cannot smuggle shell tokens.
    const pm = /^[a-z0-9@/_.-]+$/i.test(pmRaw) ? pmRaw : 'npm'

    if (process.platform === 'darwin') {
      // Every part is POSIX-quoted first, so neither the cwd nor the script
      // name can inject into the shell Terminal will run.
      const command = `cd ${shq(cwd)} && ${shq(pm)} run ${shq(script)}`
      const apple = `tell application "Terminal" to do script "${appleScriptString(command)}"\n` +
        `tell application "Terminal" to activate`
      const child = spawn('osascript', ['-e', apple], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true }
    }

    const child = spawn(pm, ['run', script], { cwd, detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  })
}
