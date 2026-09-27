import { randomBytes } from 'crypto'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { getHelper } from '../computer/service'
import { createRecorderService, type RecorderService } from '../recorder/service'
import { createDesktopSource } from '../recorder/desktopSource'
import { captureBrowserFrame, startBrowserRecording, stopBrowserRecording } from './browser'
import { readUserSkill, saveUserSkill } from '../localSkills'
import { recordLabels } from '../trayLabels'
import { appLanguage } from '../appLanguage'
import type { RecorderEvent } from '../recorder/types'
import { refreshTrayMenu, setTrayRecordActions } from '../tray'

let service: RecorderService | null = null
const listeners = new Set<(ev: RecorderEvent) => void>()

/** Tray / menu follow the recording state. */
export function onRecorderEvent(fn: (ev: RecorderEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const desktop = createDesktopSource({
  helper: () => getHelper(),
  ignorePids: () => [process.pid],
  onStopRequest: () => void getRecorderService().stop('esc'),
  onLost: () => getRecorderService().sourceLost('desktop', 'Recording of Mac apps stopped early: the native helper quit. Steps after that point are missing.'),
  pillText: () => recordLabels(appLanguage()).pill
})

export function getRecorderService(): RecorderService {
  if (!service) {
    service = createRecorderService({
      sources: {
        browser: {
          start: async (onEvent) => startBrowserRecording(randomBytes(16).toString('hex'), onEvent),
          stop: () => stopBrowserRecording(),
          capture: () => captureBrowserFrame()
        },
        desktop
      },
      emit: (ev) => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) win.webContents.send('recorder:event', ev)
        for (const l of Array.from(listeners)) {
          try {
            l(ev)
          } catch {
            /* listener errors never break recording */
          }
        }
      }
    })
  }
  return service
}

/** Ask the renderer to open the recording setup (tray / app menu). */
export function requestRecordingSetup(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('recorder:event', { type: 'open-setup' })
}

/** Record & Replay (macOS): record a demo, hand the bundle to the renderer, save the drafted skill. */
export function registerRecorderIpc(): void {
  const svc = getRecorderService()
  if (process.platform === 'darwin') {
    setTrayRecordActions({
      recording: () => svc.isRecording(),
      start: () => requestRecordingSetup(),
      stop: () => void svc.stop('user')
    })
    onRecorderEvent((ev) => {
      if (ev.type === 'started' || ev.type === 'finished' || ev.type === 'cancelled') refreshTrayMenu()
    })
  }
  handleTrusted('recorder:status', () => svc.status())
  handleTrusted('recorder:readiness', async () => ({
    platform: process.platform,
    desktop: process.platform === 'darwin' ? await desktop.readiness() : { supported: false, accessibility: false, screenRecording: false }
  }))
  handleTrusted('recorder:start', (_e, req: unknown) => svc.start((req && typeof req === 'object' ? req : {}) as Record<string, unknown>))
  handleTrusted('recorder:stop', () => svc.stop('user'))
  handleTrusted('recorder:cancel', () => svc.cancel('user'))
  handleTrusted('recorder:openPermissions', async (_e, which: unknown) => {
    const h = getHelper()
    if (!h?.isAvailable) return { ok: false }
    try {
      await h.call('permissions', { prompt: true })
      const { shell } = await import('electron')
      const pane = which === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility'
      await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })
  handleTrusted('skills:saveLocal', (_e, name: unknown, content: unknown, opts: unknown) =>
    saveUserSkill(name, content, { overwrite: !!(opts && typeof opts === 'object' && (opts as { overwrite?: boolean }).overwrite) })
  )
  handleTrusted('skills:readLocal', (_e, name: unknown) => readUserSkill(name))
}

export function disposeRecorder(): void {
  void service?.cancel('window_closed')
}
