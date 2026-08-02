import { Notification, app, shell, systemPreferences } from 'electron'
import { spawn } from 'child_process'
import { handleTrusted } from './trust'
import { setTrayEnabled, setTrayLanguage, trayEnabled } from '../tray'

export function registerMiscIpc(): void {
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
    await shell.openExternal(url)
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

  handleTrusted('workspace:runScript', async (_, cwd: string, script: string, packageManager: string) => {
    if (!cwd || !script) return { error: 'cwd and script are required' }
    const pm = packageManager && packageManager.trim() ? packageManager.trim() : 'npm'

    if (process.platform === 'darwin') {
      const escapedCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const escapedScript = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const escapedPm = pm.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const command = `cd \"${escapedCwd}\" && ${escapedPm} run ${escapedScript}`
      const apple = `tell application \"Terminal\" to do script \"${command}\"\n` +
        `tell application \"Terminal\" to activate`
      const child = spawn('osascript', ['-e', apple], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true }
    }

    const child = spawn(pm, ['run', script], { cwd, detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  })
}
