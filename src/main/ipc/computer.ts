import { handleTrusted } from './trust'
import {
  takeScreenshot,
  listDisplays,
  mouseClick,
  mouseMove,
  mouseDrag,
  mouseScroll,
  typeText,
  keypress,
  clipboardRead,
  clipboardWrite,
  imageToLogical,
  clampLogicalPoint,
  computerPreflight,
  sleep
} from '../computer'

/** Last screenshot geometry for converting image coords → screen logical coords. */
let lastShotMeta: {
  imageWidth: number
  imageHeight: number
  screenWidth: number
  screenHeight: number
} | null = null

function resolvePoint(
  x: number,
  y: number,
  coordSpace?: string
): { x: number; y: number; clamped?: boolean } {
  const space = (coordSpace || 'image').toLowerCase()
  let pt =
    space === 'screen' || space === 'logical' || !lastShotMeta
      ? { x: Math.round(x), y: Math.round(y) }
      : imageToLogical(x, y, lastShotMeta)
  const clamped = clampLogicalPoint(pt.x, pt.y)
  return { x: clamped.x, y: clamped.y, clamped: clamped.clamped }
}

async function maybeShot(returnScreenshot?: boolean, displayId?: number | null) {
  if (!returnScreenshot) return {}
  const shot = await takeScreenshot({ displayId })
  if (shot.dataUrl && shot.width && shot.height && shot.screenWidth && shot.screenHeight) {
    lastShotMeta = {
      imageWidth: shot.width,
      imageHeight: shot.height,
      screenWidth: shot.screenWidth,
      screenHeight: shot.screenHeight
    }
  }
  return {
    screenshot: shot.dataUrl,
    screenshotMeta: shot.dataUrl
      ? {
          width: shot.width,
          height: shot.height,
          screenWidth: shot.screenWidth,
          screenHeight: shot.screenHeight,
          displayId: shot.displayId
        }
      : undefined,
    screenshotError: shot.error
  }
}

export function registerComputerIpc(): void {
  handleTrusted('computer:screenshot', async (_e, opts?: { displayId?: number; maxWidth?: number }) => {
    const shot = await takeScreenshot(opts)
    if (shot.dataUrl && shot.width && shot.height && shot.screenWidth && shot.screenHeight) {
      lastShotMeta = {
        imageWidth: shot.width,
        imageHeight: shot.height,
        screenWidth: shot.screenWidth,
        screenHeight: shot.screenHeight
      }
    }
    return shot
  })

  handleTrusted('computer:displays', async () => {
    return { displays: listDisplays() }
  })

  handleTrusted('computer:preflight', async () => {
    return computerPreflight()
  })

  handleTrusted(
    'computer:click',
    async (
      _e,
      x: number,
      y: number,
      opts?: {
        button?: string
        clicks?: number
        coordSpace?: string
        returnScreenshot?: boolean
        displayId?: number
      }
    ) => {
      const nx = Number(x)
      const ny = Number(y)
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        return { error: 'x and y must be finite numbers' }
      }
      const p = resolvePoint(nx, ny, opts?.coordSpace)
      const res = await mouseClick(p.x, p.y, { button: opts?.button, clicks: opts?.clicks })
      if (res.error) return res
      const extra = await maybeShot(opts?.returnScreenshot, opts?.displayId)
      return { ok: true, x: p.x, y: p.y, clamped: Boolean(p.clamped), ...extra }
    }
  )

  handleTrusted(
    'computer:move',
    async (_e, x: number, y: number, opts?: { coordSpace?: string }) => {
      const nx = Number(x)
      const ny = Number(y)
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        return { error: 'x and y must be finite numbers' }
      }
      const p = resolvePoint(nx, ny, opts?.coordSpace)
      const res = await mouseMove(p.x, p.y)
      if (res.error) return res
      return { ok: true, x: p.x, y: p.y }
    }
  )

  handleTrusted(
    'computer:drag',
    async (
      _e,
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      opts?: {
        button?: string
        steps?: number
        coordSpace?: string
        returnScreenshot?: boolean
        displayId?: number
      }
    ) => {
      const coords = [fromX, fromY, toX, toY].map(Number)
      if (coords.some((n) => !Number.isFinite(n))) {
        return { error: 'drag coordinates must be finite numbers' }
      }
      const a = resolvePoint(coords[0], coords[1], opts?.coordSpace)
      const b = resolvePoint(coords[2], coords[3], opts?.coordSpace)
      const res = await mouseDrag(a, b, { button: opts?.button, steps: opts?.steps })
      if (res.error) return res
      const extra = await maybeShot(opts?.returnScreenshot, opts?.displayId)
      return { ok: true, from: a, to: b, ...extra }
    }
  )

  handleTrusted(
    'computer:scroll',
    async (
      _e,
      x: number,
      y: number,
      opts?: {
        dy?: number
        dx?: number
        coordSpace?: string
        returnScreenshot?: boolean
        displayId?: number
      }
    ) => {
      const nx = Number(x)
      const ny = Number(y)
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        return { error: 'x and y must be finite numbers' }
      }
      const p = resolvePoint(nx, ny, opts?.coordSpace)
      const res = await mouseScroll(p.x, p.y, { dy: opts?.dy, dx: opts?.dx })
      if (res.error) return res
      const extra = await maybeShot(opts?.returnScreenshot, opts?.displayId)
      return { ok: true, x: p.x, y: p.y, ...extra }
    }
  )

  handleTrusted('computer:type', async (_e, text: string, opts?: { returnScreenshot?: boolean }) => {
    // Bound huge paste payloads that freeze the accessibility layer.
    const body = String(text ?? '').slice(0, 20_000)
    const res = await typeText(body)
    if (res.error) return res
    const extra = await maybeShot(opts?.returnScreenshot)
    return { ok: true, ...extra }
  })

  handleTrusted('computer:keypress', async (_e, key: string, opts?: { returnScreenshot?: boolean }) => {
    const k = String(key ?? '').slice(0, 64)
    if (!k) return { error: 'key is required' }
    const res = await keypress(k)
    if (res.error) return res
    const extra = await maybeShot(opts?.returnScreenshot)
    return { ok: true, ...extra }
  })

  handleTrusted('computer:clipboard', async (_e, action: string, text?: string) => {
    const a = String(action || 'get').toLowerCase()
    if (a === 'get' || a === 'read') return clipboardRead()
    if (a === 'set' || a === 'write') return clipboardWrite(String(text ?? '').slice(0, 200_000))
    return { error: 'action must be get or set' }
  })

  handleTrusted('computer:wait', async (_e, ms: number) => {
    const clamped = Math.min(Math.max(0, Math.floor(Number(ms) || 0)), 60_000)
    await sleep(clamped)
    return { ok: true, ms: clamped }
  })
}
