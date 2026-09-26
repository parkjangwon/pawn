/**
 * Computer-use engine: model-facing actions on top of the native helper.
 *
 * Coordinate contract (same as Claude / OpenAI computer use): every x/y the
 * model sends or receives is in the pixel space of its most recent
 * screenshot (top-left origin). The engine maps image pixels ↔ global screen
 * points using the captured region, so downscaled screenshots, Retina
 * displays, and secondary monitors (negative origins) all line up. Zoom images
 * never change the mapping.
 *
 * No Electron imports: the helper is injected, so this is unit-testable.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface CuaLike {
  call<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>
}

export interface ShotPolicy {
  maxLongEdge: number
  maxPixels: number
  format: 'jpeg' | 'png'
  quality: number
}

/** Fits every vision model (Claude ≤4.x limits: 1568 px long edge, ~1.15 MP). */
export const STANDARD_POLICY: ShotPolicy = { maxLongEdge: 1568, maxPixels: 1_150_000, format: 'jpeg', quality: 0.85 }
/** High-resolution tier (Claude Opus 4.7+/5.x, GPT-5.x): sharper text, better clicks. */
export const HIGH_RES_POLICY: ShotPolicy = { maxLongEdge: 1920, maxPixels: 3_000_000, format: 'jpeg', quality: 0.85 }

export interface Frame {
  region: Rect
  width: number
  height: number
  displayId?: number
  windowId?: number
}

export interface ComputerImage {
  dataUrl: string
  width: number
  height: number
}

export interface ComputerResult {
  ok: boolean
  text: string
  image?: ComputerImage
  data?: Record<string, unknown>
}

export class ComputerActionError extends Error {
  constructor(
    message: string,
    readonly code = 'failed'
  ) {
    super(message)
  }
}

type Args = Record<string, unknown>

const n = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}
const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

/** Accepts [x, y], {x, y}, or separate x/y keys. */
export function pointArg(args: Args, key = 'coordinate', xKey = 'x', yKey = 'y'): [number, number] | undefined {
  const raw = args[key]
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = n(raw[0])
    const y = n(raw[1])
    if (x !== undefined && y !== undefined) return [x, y]
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Args
    const x = n(o.x)
    const y = n(o.y)
    if (x !== undefined && y !== undefined) return [x, y]
  }
  const x = n(args[xKey])
  const y = n(args[yKey])
  return x !== undefined && y !== undefined ? [x, y] : undefined
}

/** Modifier list from "shift", "ctrl+shift", ["cmd","alt"]. */
export function modifiersArg(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(/[+,\s]+/).filter(Boolean)
  return []
}

/** Same math as the helper's Capture.fit (keep in sync). */
export function fitSize(w: number, h: number, p: Pick<ShotPolicy, 'maxLongEdge' | 'maxPixels'>): { width: number; height: number } {
  let scale = 1
  if (p.maxLongEdge > 0) scale = Math.min(scale, p.maxLongEdge / Math.max(w, h))
  if (p.maxPixels > 0 && w * h > p.maxPixels) scale = Math.min(scale, Math.sqrt(p.maxPixels / (w * h)))
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) }
}

export function toGlobal(frame: Frame, x: number, y: number): { x: number; y: number } {
  return {
    x: frame.region.x + x * (frame.region.width / frame.width),
    y: frame.region.y + y * (frame.region.height / frame.height)
  }
}

export function toImage(frame: Frame, gx: number, gy: number): { x: number; y: number } {
  return {
    x: Math.round((gx - frame.region.x) * (frame.width / frame.region.width)),
    y: Math.round((gy - frame.region.y) * (frame.height / frame.region.height))
  }
}

/** Rewrite "@(cx,cy WxH)" points in a UI outline from screen points to image pixels. */
export function rewriteOutline(text: string, frame: Frame): string {
  const kx = frame.width / frame.region.width
  const ky = frame.height / frame.region.height
  return text.replace(/@\((-?\d+),(-?\d+) (\d+)x(\d+)\)/g, (_m, cx: string, cy: string, w: string, h: string) => {
    const p = toImage(frame, Number(cx), Number(cy))
    return `@(${p.x},${p.y} ${Math.max(1, Math.round(Number(w) * kx))}x${Math.max(1, Math.round(Number(h) * ky))})`
  })
}

interface HelperShot {
  data: string
  mime: string
  width: number
  height: number
  region: Rect
  display: { id: number; frame: Rect; scale: number; name: string; primary: boolean }
  cursor: { x: number; y: number }
  marks?: Array<{ id: number; role: string; label: string; center: { x: number; y: number } }>
}

interface HelperDisplay {
  id: number
  frame: Rect
  scale: number
  name: string
  primary: boolean
  pixelWidth: number
  pixelHeight: number
}

export class ComputerEngine {
  frame: Frame | null = null
  policy: ShotPolicy = STANDARD_POLICY

  constructor(private readonly cua: CuaLike) {}

  setPolicy(p: Partial<ShotPolicy> | undefined): void {
    if (!p) return
    this.policy = { ...this.policy, ...p }
  }

  /** Mapping for coordinates when the model acts before any screenshot. */
  async ensureFrame(): Promise<Frame> {
    if (this.frame) return this.frame
    const res = await this.cua.call<{ displays: HelperDisplay[] }>('displays')
    const d = res.displays.find((x) => x.primary) ?? res.displays[0]
    if (!d) throw new ComputerActionError('No display found', 'no_display')
    const size = fitSize(d.frame.width, d.frame.height, this.policy)
    this.frame = { region: d.frame, width: size.width, height: size.height, displayId: d.id }
    return this.frame
  }

  async point(args: Args, key = 'coordinate', xKey = 'x', yKey = 'y'): Promise<{ x: number; y: number } | undefined> {
    const p = pointArg(args, key, xKey, yKey)
    if (!p) return undefined
    if (s(args.coord_space) === 'screen') return { x: p[0], y: p[1] }
    return toGlobal(await this.ensureFrame(), p[0], p[1])
  }

  private shotParams(extra: Args = {}): Args {
    return {
      maxLongEdge: this.policy.maxLongEdge,
      maxPixels: this.policy.maxPixels,
      format: this.policy.format,
      quality: this.policy.quality,
      ...extra
    }
  }

  private image(shot: HelperShot): ComputerImage {
    return { dataUrl: `data:${shot.mime};base64,${shot.data}`, width: shot.width, height: shot.height }
  }

  async screenshot(args: Args = {}): Promise<ComputerResult> {
    const params: Args = this.shotParams({ showCursor: args.show_cursor !== false })
    const displayId = n(args.display_id)
    const windowId = n(args.window_id)
    if (displayId !== undefined) params.displayId = displayId
    else if (this.frame?.displayId !== undefined && windowId === undefined && !args.primary) params.displayId = this.frame.displayId
    if (windowId !== undefined) params.windowId = windowId
    if (args.annotate === true || args.annotate === 'ax' || args.som === true) {
      params.annotate = 'ax'
      if (s(args.app)) params.app = s(args.app)
      if (n(args.pid) !== undefined) params.pid = n(args.pid)
    }
    const shot = await this.cua.call<HelperShot>('screenshot', params)
    this.frame = {
      region: shot.region,
      width: shot.width,
      height: shot.height,
      displayId: shot.display?.id,
      ...(windowId !== undefined ? { windowId } : {})
    }
    const cursor = toImage(this.frame, shot.cursor.x, shot.cursor.y)
    const onImage = cursor.x >= 0 && cursor.y >= 0 && cursor.x < shot.width && cursor.y < shot.height
    const lines = [
      `screenshot ${shot.width}x${shot.height} (${windowId !== undefined ? `window ${windowId}` : `display ${shot.display?.id} "${shot.display?.name}"`}; ` +
        `1 image px = ${(shot.region.width / shot.width).toFixed(2)} screen pt)`,
      onImage ? `cursor at (${cursor.x}, ${cursor.y})` : 'cursor is on another display',
      'Coordinates for every computer_* action are in this image\'s pixel space (origin top-left).'
    ]
    if (shot.marks?.length) {
      lines.push(
        `Numbered boxes mark ${shot.marks.length} UI elements — act on one with computer_click {"element": N} or computer_ui_action:`,
        ...shot.marks.slice(0, 80).map((m) => {
          const c = toImage(this.frame!, m.center.x, m.center.y)
          return `  [${m.id}] ${String(m.role).replace(/^AX/, '').toLowerCase()} "${String(m.label).slice(0, 60)}" @(${c.x},${c.y})`
        })
      )
    }
    return { ok: true, text: lines.join('\n'), image: this.image(shot), data: { width: shot.width, height: shot.height } }
  }

  async zoom(args: Args): Promise<ComputerResult> {
    const r = args.region
    let box: [number, number, number, number] | undefined
    if (Array.isArray(r) && r.length === 4) {
      const v = r.map(n)
      if (v.every((x) => x !== undefined)) box = v as [number, number, number, number]
    }
    if (!box) {
      const x = n(args.x)
      const y = n(args.y)
      const w = n(args.width)
      const h = n(args.height)
      if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) box = [x, y, x + w, y + h]
    }
    if (!box) throw new ComputerActionError('zoom needs region [x0, y0, x1, y1] in screenshot pixels', 'bad_args')
    const frame = await this.ensureFrame()
    const a = toGlobal(frame, Math.min(box[0], box[2]), Math.min(box[1], box[3]))
    const b = toGlobal(frame, Math.max(box[0], box[2]), Math.max(box[1], box[3]))
    if (b.x - a.x < 2 || b.y - a.y < 2) throw new ComputerActionError('zoom region is too small', 'bad_args')
    const shot = await this.cua.call<HelperShot>('zoom', this.shotParams({ region: [a.x, a.y, b.x, b.y], showCursor: true }))
    return {
      ok: true,
      text: `zoom of region [${box.map(Math.round).join(', ')}] at ${shot.width}x${shot.height}. Keep using full-screenshot coordinates for actions.`,
      image: this.image(shot)
    }
  }

  private async maybeShot(args: Args, res: ComputerResult): Promise<ComputerResult> {
    if (args.return_screenshot !== true) return res
    await new Promise((r) => setTimeout(r, n(args.settle_ms) ?? 250))
    const shot = await this.screenshot({})
    return { ok: res.ok, text: `${res.text}\n${shot.text}`, image: shot.image }
  }

  async execute(action: string, args: Args = {}): Promise<ComputerResult> {
    switch (action) {
      case 'screenshot':
        return this.screenshot(args)
      case 'zoom':
        return this.zoom(args)

      case 'cursor':
      case 'cursor_position': {
        const c = await this.cua.call<{ x: number; y: number }>('cursor')
        const p = toImage(await this.ensureFrame(), c.x, c.y)
        return { ok: true, text: `X=${p.x}, Y=${p.y}`, data: p }
      }

      case 'click':
      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click':
      case 'triple_click': {
        const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : s(args.button) || 'left'
        const clicks = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : Math.max(1, Math.min(3, n(args.clicks) ?? 1))
        const modifiers = modifiersArg(args.modifiers ?? args.text)
        const element = n(args.element)
        if (element !== undefined && clicks === 1 && modifiers.length === 0) {
          const res = await this.cua.call<Record<string, unknown>>('ui_action', {
            element,
            action: button === 'right' ? 'show_menu' : 'press'
          })
          return this.maybeShot(args, { ok: true, text: `${button === 'right' ? 'Opened menu of' : 'Pressed'} element [${element}] ${res.role ?? ''} "${res.label ?? ''}" (${res.performed})` })
        }
        let pt = await this.point(args)
        if (!pt && element !== undefined) {
          const info = await this.cua.call<{ center?: { x: number; y: number } }>('ui_element', { element })
          if (!info.center) throw new ComputerActionError(`Element [${element}] has no on-screen position`, 'no_position')
          pt = info.center
        }
        await this.cua.call('click', { ...(pt ?? {}), button, clicks, modifiers })
        const where = pt ? pointArg(args)?.map(Math.round).join(', ') ?? `element ${element}` : 'current cursor'
        const kind = clicks === 3 ? 'Triple-clicked' : clicks === 2 ? 'Double-clicked' : button === 'right' ? 'Right-clicked' : button === 'middle' ? 'Middle-clicked' : 'Clicked'
        return this.maybeShot(args, { ok: true, text: `${kind} at (${where})${modifiers.length ? ` with ${modifiers.join('+')}` : ''}` })
      }

      case 'move':
      case 'mouse_move': {
        const pt = await this.point(args)
        if (!pt) throw new ComputerActionError('coordinate [x, y] is required', 'bad_args')
        await this.cua.call('move', { ...pt, modifiers: modifiersArg(args.modifiers) })
        return this.maybeShot(args, { ok: true, text: `Moved cursor to (${pointArg(args)!.map(Math.round).join(', ')})` })
      }

      case 'mouse_down':
      case 'left_mouse_down':
      case 'mouse_up':
      case 'left_mouse_up': {
        const down = action.endsWith('down')
        const pt = await this.point(args)
        await this.cua.call(down ? 'mouse_down' : 'mouse_up', { ...(pt ?? {}), button: s(args.button) || 'left', modifiers: modifiersArg(args.modifiers) })
        return this.maybeShot(args, { ok: true, text: `Mouse ${down ? 'down' : 'up'}${pt ? ` at (${pointArg(args)!.map(Math.round).join(', ')})` : ''}` })
      }

      case 'drag':
      case 'left_click_drag': {
        let path: Array<{ x: number; y: number }> = []
        if (Array.isArray(args.path) && args.path.length >= 2) {
          const frame = await this.ensureFrame()
          for (const raw of args.path) {
            const p = pointArg({ coordinate: raw })
            if (!p) throw new ComputerActionError('path must be [[x, y], …]', 'bad_args')
            path.push(s(args.coord_space) === 'screen' ? { x: p[0], y: p[1] } : toGlobal(frame, p[0], p[1]))
          }
        } else {
          const from =
            (await this.point(args, 'start_coordinate')) ?? (await this.point(args, 'from', 'from_x', 'from_y'))
          const to = (await this.point(args, 'coordinate')) ?? (await this.point(args, 'to', 'to_x', 'to_y'))
          if (!from || !to) throw new ComputerActionError('drag needs from/start_coordinate and to/coordinate', 'bad_args')
          path = [from, to]
        }
        await this.cua.call('drag', {
          path: path.map((p) => [p.x, p.y]),
          button: s(args.button) || 'left',
          modifiers: modifiersArg(args.modifiers ?? args.text),
          durationMs: n(args.duration_ms) ?? 400
        })
        return this.maybeShot(args, { ok: true, text: `Dragged along ${path.length} points` })
      }

      case 'scroll': {
        const pt = await this.point(args)
        const direction = s(args.direction ?? args.scroll_direction)
        const amount = n(args.amount ?? args.scroll_amount)
        const params: Args = { ...(pt ?? {}), modifiers: modifiersArg(args.modifiers ?? args.text) }
        if (direction) {
          params.direction = direction
          params.amount = amount ?? 3
        } else {
          params.dy = n(args.dy) ?? 0
          params.dx = n(args.dx) ?? 0
        }
        await this.cua.call('scroll', params)
        return this.maybeShot(args, { ok: true, text: `Scrolled ${direction ? `${direction} ${amount ?? 3}` : `dy=${params.dy} dx=${params.dx}`}` })
      }

      case 'type': {
        const text = s(args.text) ?? ''
        if (!text) throw new ComputerActionError('text is required', 'bad_args')
        const res = await this.cua.call<{ method?: string }>('type', { text, method: s(args.method) })
        return this.maybeShot(args, { ok: true, text: `Typed ${text.length} characters${res.method === 'paste' ? ' (via paste)' : ''}` })
      }

      case 'key':
      case 'keypress': {
        const key = s(args.key ?? args.text)
        if (!key) throw new ComputerActionError('key is required (e.g. "Return", "cmd+s")', 'bad_args')
        const repeat = Math.max(1, Math.min(100, n(args.repeat) ?? 1))
        await this.cua.call('key', { key, repeat })
        return this.maybeShot(args, { ok: true, text: `Pressed ${key}${repeat > 1 ? ` ×${repeat}` : ''}` })
      }

      case 'hold_key': {
        const key = s(args.key ?? args.text)
        if (!key) throw new ComputerActionError('key is required', 'bad_args')
        const seconds = n(args.duration)
        const ms = Math.min(300_000, Math.max(10, n(args.duration_ms) ?? (seconds !== undefined ? seconds * 1000 : 500)))
        await this.cua.call('hold_key', { key, durationMs: ms })
        return this.maybeShot(args, { ok: true, text: `Held ${key} for ${ms} ms` })
      }

      case 'wait': {
        const seconds = n(args.duration)
        const ms = Math.min(300_000, Math.max(0, n(args.ms) ?? (seconds !== undefined ? seconds * 1000 : 1000)))
        await this.cua.call('wait', { ms })
        return this.maybeShot(args, { ok: true, text: `Waited ${ms} ms` })
      }

      case 'ui_snapshot': {
        const res = await this.cua.call<{ text: string; interactive: number; truncated: boolean }>('ui_snapshot', {
          ...(n(args.pid) !== undefined ? { pid: n(args.pid) } : {}),
          ...(s(args.app) ? { app: s(args.app) } : {}),
          scope: s(args.scope) || 'window',
          ...(s(args.query) ? { query: s(args.query) } : {}),
          maxNodes: n(args.max_nodes) ?? 350,
          interactiveOnly: args.interactive_only === true
        })
        const frame = await this.ensureFrame()
        return {
          ok: true,
          text:
            rewriteOutline(res.text, frame) +
            `\n\n${res.interactive} actionable elements. [N] = element id for computer_click {"element": N} / computer_ui_action. ` +
            '@(x,y WxH) = center and size in screenshot pixels.'
        }
      }

      case 'ui_action': {
        const element = n(args.element)
        if (element === undefined) throw new ComputerActionError('element is required (from computer_ui_snapshot)', 'bad_args')
        const res = await this.cua.call<Record<string, unknown>>('ui_action', {
          element,
          action: s(args.action) || 'press',
          ...(args.value !== undefined ? { value: String(args.value) } : {})
        })
        return this.maybeShot(args, { ok: true, text: `${s(args.action) || 'press'} [${element}] ${res.role ?? ''} "${res.label ?? ''}" → ${res.performed}` })
      }

      case 'ui_find':
      case 'find': {
        const query = s(args.query ?? args.text)
        if (!query) throw new ComputerActionError('query is required', 'bad_args')
        const frame = await this.ensureFrame()
        const lines: string[] = []
        if (args.ocr !== true) {
          try {
            const ax = await this.cua.call<{ text: string; matches: unknown[] }>('ui_find', {
              query,
              ...(s(args.app) ? { app: s(args.app) } : {}),
              ...(n(args.pid) !== undefined ? { pid: n(args.pid) } : {}),
              scope: s(args.scope) || 'app'
            })
            if (ax.matches.length) lines.push(`Accessibility matches:\n${rewriteOutline(ax.text, frame)}`)
          } catch {
            /* fall through to OCR */
          }
        }
        if (!lines.length || args.ocr === true) {
          let ocr: { matches: Array<{ text: string; center: { x: number; y: number }; frame: Rect }> } = { matches: [] }
          try {
            ocr = await this.cua.call('find_text', {
              query,
              region: [frame.region.x, frame.region.y, frame.region.x + frame.region.width, frame.region.y + frame.region.height]
            })
          } catch (err) {
            lines.length || lines.push(`(OCR unavailable: ${err instanceof Error ? err.message : String(err)})`)
          }
          if (ocr.matches.length) {
            lines.push(
              'On-screen text matches (OCR):',
              ...ocr.matches.slice(0, 15).map((m) => {
                const c = toImage(frame, m.center.x, m.center.y)
                return `  "${m.text.slice(0, 80)}" @(${c.x},${c.y})`
              })
            )
          }
        }
        const found = lines.some((l) => !l.startsWith('(OCR unavailable'))
        return found
          ? { ok: true, text: `${lines.join('\n')}\nClick a match with computer_click {"element": N} or its @(x,y).` }
          : { ok: false, text: `No element or visible text matching "${query}". Take a screenshot, scroll, or open the right window.${lines.length ? `\n${lines.join('\n')}` : ''}` }
      }

      case 'ocr': {
        const frame = await this.ensureFrame()
        let region: number[] | undefined
        if (Array.isArray(args.region) && args.region.length === 4) {
          const v = args.region.map(n)
          if (v.every((x) => x !== undefined)) {
            const a = toGlobal(frame, Math.min(v[0]!, v[2]!), Math.min(v[1]!, v[3]!))
            const b = toGlobal(frame, Math.max(v[0]!, v[2]!), Math.max(v[1]!, v[3]!))
            region = [a.x, a.y, b.x, b.y]
          }
        }
        region ??= [frame.region.x, frame.region.y, frame.region.x + frame.region.width, frame.region.y + frame.region.height]
        const res = await this.cua.call<{ lines: Array<{ text: string; center: { x: number; y: number } }>; count: number }>('ocr', {
          region,
          limit: n(args.limit) ?? 250
        })
        const body = res.lines.map((l) => {
          const c = toImage(frame, l.center.x, l.center.y)
          return `@(${c.x},${c.y}) ${l.text}`
        })
        return { ok: true, text: body.length ? `${res.count} text lines (@ = center in screenshot pixels):\n${body.join('\n')}` : 'No text recognized.' }
      }

      case 'apps': {
        const sub = s(args.action) || 'list'
        const target: Args = {
          ...(s(args.app) ? { app: s(args.app) } : {}),
          ...(s(args.bundle_id) ? { bundleId: s(args.bundle_id) } : {}),
          ...(n(args.pid) !== undefined ? { pid: n(args.pid) } : {})
        }
        if (sub === 'list') {
          const res = await this.cua.call<{ apps: Array<Record<string, unknown>>; frontmost: string }>('apps', { all: args.all === true })
          const rows = res.apps.map((a) => `- ${a.name}${a.active ? ' (frontmost)' : ''}${a.hidden ? ' (hidden)' : ''} pid=${a.pid} ${a.bundleId}`)
          return { ok: true, text: `Running apps (frontmost: ${res.frontmost}):\n${rows.join('\n')}` }
        }
        if (!Object.keys(target).length) throw new ComputerActionError('app (name or bundle id) is required', 'bad_args')
        const method = sub === 'launch' || sub === 'open' ? 'launch' : sub
        if (!['launch', 'activate', 'hide', 'quit'].includes(method)) {
          throw new ComputerActionError('action must be list, launch, activate, hide, or quit', 'bad_args')
        }
        const res = await this.cua.call<Record<string, unknown>>(method, { ...target, ...(args.force === true ? { force: true } : {}) })
        return this.maybeShot(args, { ok: true, text: `${method} ${s(args.app) ?? s(args.bundle_id) ?? ''}: ${JSON.stringify(res)}` })
      }

      case 'windows': {
        const sub = s(args.action) || 'list'
        if (sub === 'list') {
          const res = await this.cua.call<{ windows: Array<{ id: number; app: string; title: string; frame: Rect; frontApp: boolean }> }>('windows', {
            ...(s(args.app) ? { app: s(args.app) } : {}),
            ...(n(args.pid) !== undefined ? { pid: n(args.pid) } : {})
          })
          const frame = await this.ensureFrame()
          const rows = res.windows.map((w) => {
            const tl = toImage(frame, w.frame.x, w.frame.y)
            const br = toImage(frame, w.frame.x + w.frame.width, w.frame.y + w.frame.height)
            return `- id=${w.id} ${w.app}${w.title ? ` — "${w.title}"` : ''} [${tl.x},${tl.y} → ${br.x},${br.y}]${w.frontApp ? ' (front app)' : ''}`
          })
          return { ok: true, text: rows.length ? `Windows (front to back, screenshot pixels):\n${rows.join('\n')}` : 'No windows.' }
        }
        const params: Args = { action: sub }
        if (n(args.window_id) !== undefined) params.windowId = n(args.window_id)
        if (n(args.pid) !== undefined) params.pid = n(args.pid)
        if (s(args.app) && params.pid === undefined && params.windowId === undefined) {
          const apps = await this.cua.call<{ apps: Array<{ name: string; pid: number; bundleId: string }> }>('apps', {})
          const want = s(args.app)!.toLowerCase()
          const hit = apps.apps.find((a) => a.name.toLowerCase() === want || a.bundleId.toLowerCase() === want) ??
            apps.apps.find((a) => a.name.toLowerCase().includes(want))
          if (hit) params.pid = hit.pid
        }
        if (sub === 'move' || sub === 'resize' || sub === 'set_frame') {
          const frame = await this.ensureFrame()
          const kx = frame.region.width / frame.width
          const ky = frame.region.height / frame.height
          if (n(args.x) !== undefined && n(args.y) !== undefined) {
            const g = toGlobal(frame, n(args.x)!, n(args.y)!)
            params.x = g.x
            params.y = g.y
          }
          if (n(args.width) !== undefined) params.width = n(args.width)! * kx
          if (n(args.height) !== undefined) params.height = n(args.height)! * ky
        }
        const res = await this.cua.call<Record<string, unknown>>('window_action', params)
        return this.maybeShot(args, { ok: true, text: `window ${sub}: ${res.title ? `"${res.title}"` : 'ok'}` })
      }

      case 'menu': {
        const sub = s(args.action) || 'list'
        const path = Array.isArray(args.path) ? args.path.map(String) : typeof args.path === 'string' ? args.path.split(/\s*>\s*/).filter(Boolean) : []
        const target: Args = {
          ...(s(args.app) ? { app: s(args.app) } : {}),
          ...(n(args.pid) !== undefined ? { pid: n(args.pid) } : {})
        }
        if (sub === 'select') {
          await this.cua.call('menu_select', { ...target, path })
          return this.maybeShot(args, { ok: true, text: `Selected menu ${path.join(' > ')}` })
        }
        const res = await this.cua.call<{ items: Array<{ title: string; shortcut?: string; enabled: boolean; submenu?: boolean }> }>('menu_list', { ...target, path })
        const rows = res.items.map((i) => `- ${i.title}${i.submenu ? ' ▸' : ''}${i.shortcut ? `  (${i.shortcut})` : ''}${i.enabled ? '' : '  [disabled]'}`)
        return { ok: true, text: `${path.length ? path.join(' > ') : 'Menu bar'}:\n${rows.join('\n')}` }
      }

      case 'open': {
        const target = s(args.target ?? args.url ?? args.path)
        if (!target) throw new ComputerActionError('target (URL or path) is required', 'bad_args')
        await this.cua.call('open', { target, ...(s(args.app) ? { app: s(args.app) } : {}) })
        return this.maybeShot(args, { ok: true, text: `Opened ${target}` })
      }

      case 'clipboard': {
        const sub = s(args.action) || 'get'
        const res = await this.cua.call<{ text?: string; files?: string[] }>('clipboard', {
          action: sub,
          ...(args.text !== undefined ? { text: String(args.text) } : {}),
          ...(Array.isArray(args.files) ? { files: args.files } : {})
        })
        if (sub === 'get' || sub === 'read') {
          return { ok: true, text: `${res.text ?? ''}${res.files?.length ? `\n[files] ${res.files.join(', ')}` : ''}` }
        }
        return { ok: true, text: 'Clipboard updated' }
      }

      case 'display_size': {
        // Screenshot size of the primary display under the current policy
        // (declared to Claude's computer_2025* tools as display_width/height).
        const res = await this.cua.call<{ displays: HelperDisplay[] }>('displays')
        const d = res.displays.find((x) => x.primary) ?? res.displays[0]
        if (!d) throw new ComputerActionError('No display found', 'no_display')
        const size = fitSize(d.frame.width, d.frame.height, this.policy)
        return { ok: true, text: `${size.width}x${size.height}`, data: size }
      }

      case 'displays': {
        const res = await this.cua.call<{ displays: HelperDisplay[] }>('displays')
        return {
          ok: true,
          text: res.displays
            .map((d) => `- display_id=${d.id}${d.primary ? ' (primary)' : ''} "${d.name}" ${d.frame.width}x${d.frame.height} pt @${d.scale}x origin (${d.frame.x},${d.frame.y})`)
            .join('\n')
        }
      }

      default:
        throw new ComputerActionError(`Unknown computer action "${action}"`, 'unknown_action')
    }
  }
}
