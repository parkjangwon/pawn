/**
 * Mac-app source for Record & Replay: the native helper (pawn-cua) watches
 * clicks, shortcuts, typing and app switches system-wide and streams them as
 * `{"event":"rec"}` lines. Pawn's own windows are ignored (the embedded
 * browser has its own, more precise recorder), secure text fields are never
 * read, and synthetic input (the agent's own clicks) is filtered out.
 *
 * No electron imports: the helper and Pawn's pid are injected.
 */

import type { CuaHelper } from '../computer/cuaHelper'
import type { FrameGrab, RecorderSourceAdapter } from './service'

export interface DesktopReadiness {
  /** Helper binary present and new enough to record. */
  supported: boolean
  accessibility: boolean
  screenRecording: boolean
  error?: string
}

export interface DesktopSourceDeps {
  helper: () => CuaHelper | null
  /** Pids whose windows must never be recorded (Pawn itself). */
  ignorePids: () => number[]
  /** Esc pressed twice while recording, or the helper died. */
  onStopRequest: (reason: 'esc') => void
  /** Text on the on-screen recording pill. */
  pillText?: () => string
  /** The helper exited while recording. */
  onLost?: () => void
}

async function helperReady(helper: CuaHelper | null): Promise<DesktopReadiness> {
  if (!helper?.isAvailable) {
    return {
      supported: false,
      accessibility: false,
      screenRecording: false,
      error: 'Recording Mac apps needs Pawn’s native helper (it ships with the app; from source run npm run build:native).'
    }
  }
  try {
    const caps = await helper.call<{ methods?: string[] }>('capabilities')
    if (!Array.isArray(caps.methods) || !caps.methods.includes('record_start')) {
      return {
        supported: false,
        accessibility: false,
        screenRecording: false,
        error: 'The native helper is too old to record. Rebuild it (npm run build:native) or update Pawn.'
      }
    }
    const p = await helper.call<{ accessibility: boolean; screenRecording: boolean }>('permissions')
    return { supported: true, accessibility: p.accessibility === true, screenRecording: p.screenRecording === true }
  } catch (err) {
    return { supported: false, accessibility: false, screenRecording: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function createDesktopSource(deps: DesktopSourceDeps): RecorderSourceAdapter & {
  readiness: () => Promise<DesktopReadiness>
} {
  let active: { helper: CuaHelper; onRec: (m: Record<string, unknown>) => void; onStop: () => void; onExit: () => void; screen: boolean } | null = null

  const detach = (): void => {
    if (!active) return
    active.helper.off('rec', active.onRec)
    active.helper.off('record_stop_request', active.onStop)
    active.helper.off('exit', active.onExit)
    active = null
  }

  return {
    readiness: () => helperReady(deps.helper()),

    async start(onEvent) {
      const helper = deps.helper()
      const ready = await helperReady(helper)
      if (!ready.supported || !helper) return { ok: false, error: ready.error }
      if (!ready.accessibility) {
        return {
          ok: false,
          error:
            'Recording Mac apps needs the Accessibility permission: System Settings → Privacy & Security → Accessibility → enable Pawn.'
        }
      }
      detach()
      const onRec = (m: Record<string, unknown>): void => {
        if (m.data && typeof m.data === 'object') onEvent(m.data)
      }
      const onStop = (): void => deps.onStopRequest('esc')
      const onExit = (): void => {
        detach()
        deps.onLost?.()
      }
      active = { helper, onRec, onStop, onExit, screen: ready.screenRecording }
      helper.on('rec', onRec)
      helper.on('record_stop_request', onStop)
      helper.on('exit', onExit)
      try {
        await helper.call('record_start', { ignorePids: deps.ignorePids(), pill: deps.pillText?.() })
      } catch (err) {
        detach()
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      const notes = ready.screenRecording
        ? []
        : ['No screenshots of Mac apps: Screen Recording permission is off (System Settings → Privacy & Security → Screen & System Audio Recording).']
      return { ok: true, notes }
    },

    async stop() {
      const a = active
      if (!a) return
      try {
        // The helper flushes pending typing and emits it before replying.
        await a.helper.call('record_stop', {}, 5000)
      } catch {
        /* helper gone: nothing left to flush */
      }
      detach()
    },

    async capture(): Promise<FrameGrab> {
      const a = active
      if (!a || !a.screen) return null
      try {
        const r = await a.helper.call<{ data?: string; mime?: string; width?: number; height?: number }>('screenshot', {
          format: 'jpeg',
          quality: 0.6,
          maxLongEdge: 1280,
          showCursor: true,
          excludeOwn: true,
          excludePids: deps.ignorePids()
        })
        if (!r?.data) return null
        return { dataUrl: `data:${r.mime || 'image/jpeg'};base64,${r.data}`, width: r.width || 0, height: r.height || 0 }
      } catch {
        return null
      }
    }
  }
}
