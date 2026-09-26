/**
 * Computer-use service (main process).
 *
 * macOS: the native pawn-cua helper (CGEvent input, ScreenCaptureKit capture,
 * Accessibility tree + actions, Vision OCR, app/window/menu control, agent
 * cursor overlay, Esc×2 emergency stop).
 * Windows / Linux, or macOS without the helper: the legacy path (Electron
 * capture + xdotool / PowerShell / cliclick) for the core actions.
 */

import { app } from 'electron'
import { CuaHelper, findHelper, helperCandidates } from './cuaHelper'
import { ComputerActionError, ComputerEngine, pointArg, modifiersArg, type ComputerResult, type ShotPolicy } from './engine'
import { takeScreenshot, listDisplays } from './screenshot'
import { mouseClick, mouseDrag, mouseMove, mouseScroll } from './mouse'
import { keypress, typeText } from './keyboard'
import { clipboardRead, clipboardWrite } from './clipboard'
import { clampLogicalPoint, computerPreflight, imageToLogical, sleep } from './platform'

let helper: CuaHelper | null = null
let engine: ComputerEngine | null = null
let abortListener: ((reason: string) => void) | null = null

export function getHelper(): CuaHelper | null {
  if (process.platform !== 'darwin') return null
  if (helper) return helper
  const path = findHelper(
    helperCandidates({
      resourcesPath: process.resourcesPath,
      appPath: (() => {
        try {
          return app.getAppPath()
        } catch {
          return undefined
        }
      })(),
      cwd: process.cwd()
    })
  )
  helper = new CuaHelper({ path })
  helper.on('user_abort', () => abortListener?.('Esc pressed twice'))
  return helper
}

function getEngine(): ComputerEngine | null {
  const h = getHelper()
  if (!h?.isAvailable) return null
  engine ??= new ComputerEngine(h)
  return engine
}

export function onUserAbort(fn: (reason: string) => void): void {
  abortListener = fn
}

export function disposeComputer(): void {
  helper?.dispose()
  helper = null
  engine = null
}

/** Which backend serves computer use right now. */
export function backendName(): 'native' | 'legacy' {
  return getEngine() ? 'native' : 'legacy'
}

// ---- Legacy backend (Windows / Linux / macOS without helper) --------------

let legacyShot: { imageWidth: number; imageHeight: number; screenWidth: number; screenHeight: number } | null = null

function legacyPoint(args: Record<string, unknown>, key = 'coordinate', xKey = 'x', yKey = 'y'): { x: number; y: number } | undefined {
  const p = pointArg(args, key, xKey, yKey)
  if (!p) return undefined
  const pt = args.coord_space === 'screen' || !legacyShot ? { x: p[0], y: p[1] } : imageToLogical(p[0], p[1], legacyShot)
  const c = clampLogicalPoint(pt.x, pt.y)
  return { x: c.x, y: c.y }
}

const UNSUPPORTED = (action: string): ComputerResult => ({
  ok: false,
  text:
    `computer ${action} needs the native helper (macOS). On this platform use computer_screenshot + coordinates ` +
    '(click, move, drag, scroll, type, key).'
})

async function legacyExecute(action: string, args: Record<string, unknown>, policy: ShotPolicy): Promise<ComputerResult> {
  const fail = (e?: string): ComputerResult => ({ ok: false, text: e || `${action} failed` })
  const shot = async (): Promise<ComputerResult> => {
    const r = await takeScreenshot({ displayId: typeof args.display_id === 'number' ? args.display_id : undefined, maxWidth: policy.maxLongEdge })
    if (r.error || !r.dataUrl) return fail(r.error)
    legacyShot = { imageWidth: r.width!, imageHeight: r.height!, screenWidth: r.screenWidth!, screenHeight: r.screenHeight! }
    return {
      ok: true,
      text: `screenshot ${r.width}x${r.height} (display ${r.displayId}). Coordinates are in this image's pixel space.`,
      image: { dataUrl: r.dataUrl, width: r.width!, height: r.height! }
    }
  }
  const after = async (res: ComputerResult): Promise<ComputerResult> => {
    if (args.return_screenshot !== true || !res.ok) return res
    await sleep(250)
    const s = await shot()
    return { ok: true, text: `${res.text}\n${s.text}`, image: s.image }
  }
  switch (action) {
    case 'screenshot':
      return shot()
    case 'click':
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'triple_click': {
      const pt = legacyPoint(args)
      if (!pt) return fail('coordinate [x, y] is required on this platform')
      if (modifiersArg(args.modifiers ?? args.text).length) return fail('modifier clicks need the native helper')
      const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : String(args.button || 'left')
      const clicks = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : Number(args.clicks) || 1
      const r = await mouseClick(pt.x, pt.y, { button, clicks })
      return r.error ? fail(r.error) : after({ ok: true, text: `Clicked (${pt.x}, ${pt.y})` })
    }
    case 'move':
    case 'mouse_move': {
      const pt = legacyPoint(args)
      if (!pt) return fail('coordinate [x, y] is required')
      const r = await mouseMove(pt.x, pt.y)
      return r.error ? fail(r.error) : after({ ok: true, text: `Moved to (${pt.x}, ${pt.y})` })
    }
    case 'drag':
    case 'left_click_drag': {
      const a = legacyPoint(args, 'start_coordinate') ?? legacyPoint(args, 'from', 'from_x', 'from_y')
      const b = legacyPoint(args, 'coordinate') ?? legacyPoint(args, 'to', 'to_x', 'to_y')
      if (!a || !b) return fail('drag needs from and to')
      const r = await mouseDrag(a, b, { button: String(args.button || 'left') })
      return r.error ? fail(r.error) : after({ ok: true, text: 'Dragged' })
    }
    case 'scroll': {
      const pt = legacyPoint(args) ?? { x: 0, y: 0 }
      const dir = String(args.direction ?? args.scroll_direction ?? '')
      const amount = Number(args.amount ?? args.scroll_amount ?? 3)
      const dy = dir === 'down' ? amount : dir === 'up' ? -amount : Number(args.dy) || 0
      const dx = dir === 'right' ? amount : dir === 'left' ? -amount : Number(args.dx) || 0
      const r = await mouseScroll(pt.x, pt.y, { dy, dx })
      return r.error ? fail(r.error) : after({ ok: true, text: 'Scrolled' })
    }
    case 'type': {
      const r = await typeText(String(args.text ?? ''))
      return r.error ? fail(r.error) : after({ ok: true, text: `Typed ${String(args.text ?? '').length} characters` })
    }
    case 'key':
    case 'keypress': {
      const key = String(args.key ?? args.text ?? '')
      const times = Math.max(1, Math.min(100, Number(args.repeat) || 1))
      for (let i = 0; i < times; i++) {
        const r = await keypress(key)
        if (r.error) return fail(r.error)
      }
      return after({ ok: true, text: `Pressed ${key}` })
    }
    case 'wait': {
      const ms = Number(args.ms) || (Number(args.duration) || 1) * 1000
      await sleep(ms)
      return after({ ok: true, text: `Waited ${ms} ms` })
    }
    case 'clipboard': {
      if (String(args.action || 'get') === 'set') {
        const r = clipboardWrite(String(args.text ?? ''))
        return r.error ? fail(r.error) : { ok: true, text: 'Clipboard updated' }
      }
      const r = clipboardRead()
      return r.error ? fail(r.error) : { ok: true, text: r.text ?? '' }
    }
    case 'display_size': {
      const d = (listDisplays() || []).find((x) => x.primary)
      if (!d) return fail('No display')
      const scale = Math.min(1, policy.maxLongEdge / Math.max(d.width, d.height), Math.sqrt(policy.maxPixels / (d.width * d.height)))
      const size = { width: Math.floor(d.width * scale), height: Math.floor(d.height * scale) }
      return { ok: true, text: `${size.width}x${size.height}`, data: size }
    }
    case 'displays':
      return {
        ok: true,
        text: (listDisplays() || []).map((d) => `- display_id=${d.id}${d.primary ? ' (primary)' : ''} ${d.label} ${d.width}x${d.height}`).join('\n')
      }
    default:
      return UNSUPPORTED(action)
  }
}

// ---- Public API ------------------------------------------------------------

export async function executeComputer(
  action: string,
  args: Record<string, unknown> = {},
  policy?: Partial<ShotPolicy>
): Promise<ComputerResult> {
  const eng = getEngine()
  if (!eng) {
    const merged = { maxLongEdge: 1568, maxPixels: 1_150_000, format: 'jpeg' as const, quality: 0.85, ...policy }
    return legacyExecute(action, args, merged)
  }
  eng.setPolicy(policy)
  try {
    return await eng.execute(action, args)
  } catch (err) {
    const code = (err as { code?: string }).code
    // Helper vanished (crash loop, deleted binary): serve what the legacy path can.
    if (code === 'unavailable' && ['screenshot', 'click', 'left_click', 'move', 'type', 'key', 'scroll', 'drag'].includes(action)) {
      return legacyExecute(action, args, { ...eng.policy })
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, text: err instanceof ComputerActionError || code ? message : `computer ${action} failed: ${message}` }
  }
}

export async function computerStatus(opts: { prompt?: boolean } = {}): Promise<{
  ok: boolean
  backend: 'native' | 'legacy'
  platform: string
  accessibility?: boolean
  screenRecording?: boolean
  helper?: string | null
  version?: string
  notes: string[]
  errors: string[]
}> {
  const h = getHelper()
  if (h?.isAvailable) {
    try {
      const p = await h.call<{ accessibility: boolean; screenRecording: boolean }>('permissions', { prompt: opts.prompt === true })
      const caps = await h.call<{ version: string; screenCaptureKit: boolean; arch: string }>('capabilities')
      const errors: string[] = []
      if (!p.accessibility) errors.push('Accessibility permission missing — System Settings → Privacy & Security → Accessibility → enable Pawn')
      if (!p.screenRecording) errors.push('Screen Recording permission missing — System Settings → Privacy & Security → Screen & System Audio Recording → enable Pawn, then restart Pawn')
      return {
        ok: errors.length === 0,
        backend: 'native',
        platform: 'darwin',
        accessibility: p.accessibility,
        screenRecording: p.screenRecording,
        helper: h.path,
        version: caps.version,
        notes: [
          `native helper ${caps.version} (${caps.arch}${caps.screenCaptureKit ? ', ScreenCaptureKit' : ''})`,
          'capabilities: screenshot/zoom, mouse/keyboard with modifiers, accessibility tree + element actions, OCR, apps/windows/menus, clipboard',
          'emergency stop: press Esc twice'
        ],
        errors
      }
    } catch (err) {
      return {
        ok: false,
        backend: 'native',
        platform: 'darwin',
        helper: h.path,
        notes: [],
        errors: [`native helper failed: ${err instanceof Error ? err.message : String(err)}`]
      }
    }
  }
  const legacy = await computerPreflight()
  return {
    ...legacy,
    backend: 'legacy',
    helper: null,
    notes: [...legacy.notes, ...(process.platform === 'darwin' ? ['native helper not found — run `npm run build:native` (dev) or reinstall Pawn'] : [])]
  }
}

export async function setOverlay(enabled: boolean, text?: string): Promise<{ ok: boolean }> {
  const h = getHelper()
  if (!h?.isAvailable) return { ok: false }
  try {
    await h.call('overlay', { enabled, ...(text ? { text } : {}) })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** Release every held key / mouse button (Stop, crash recovery). */
export async function releaseAll(): Promise<void> {
  const h = helper
  if (!h?.isAvailable) return
  try {
    await h.call('release_all', {}, 3_000)
  } catch {
    /* best effort */
  }
}
