import { Notification, shell, systemPreferences } from 'electron'
import { spawn } from 'child_process'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'

// Recurring timers created by the renderer; the main process owns them so they
// survive renderer reloads and keep ticking while the window is hidden.
const scheduledTasks: Map<string, NodeJS.Timeout> = new Map()

export function registerMiscIpc(): void {
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

  handleTrusted('schedule:add', async (_, id: string, intervalMs: number, payload: unknown) => {
    if (scheduledTasks.has(id)) {
      clearInterval(scheduledTasks.get(id)!)
    }
    const timer = setInterval(() => {
      getMainWindow()?.webContents.send('schedule:tick', { id, payload })
    }, intervalMs)
    scheduledTasks.set(id, timer)
    return { ok: true }
  })

  handleTrusted('schedule:remove', async (_, id: string) => {
    const timer = scheduledTasks.get(id)
    if (timer) {
      clearInterval(timer)
      scheduledTasks.delete(id)
    }
    return { ok: true }
  })

  handleTrusted('schedule:list', async () => {
    return Array.from(scheduledTasks.keys())
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
