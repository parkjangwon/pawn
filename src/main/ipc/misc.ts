import { Notification, app, ipcMain, shell, systemPreferences } from 'electron'
import { spawn } from 'child_process'
import { resolve, sep } from 'path'
import { handleTrusted, isTrustedSender } from './trust'
import { setTrayEnabled, setTrayLanguage, trayEnabled } from '../tray'
import { setAppStreaming } from '../streamingState'
import { getPawnDir } from '../config'

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
  ipcMain.on('app:streaming', (event, streaming: boolean) => {
    if (!isTrustedSender(event)) return
    setAppStreaming(streaming === true)
  })

  handleTrusted('app:getVersion', async () => app.getVersion())

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
      new Notification({ title, body }).show()
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
