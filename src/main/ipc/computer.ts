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
): { x: number; y: number } {
  const space = (coordSpace || 'image').toLowerCase()
  if (space === 'screen' || space === 'logical' || !lastShotMeta) {
    return { x: Math.round(x), y: Math.round(y) }
  }
  return imageToLogical(x, y, lastShotMeta)
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
      const p = resolvePoint(Number(x), Number(y), opts?.coordSpace)
      const res = await mouseClick(p.x, p.y, { button: opts?.button, clicks: opts?.clicks })
      if (res.error) return res
      const extra = await maybeShot(opts?.returnScreenshot, opts?.displayId)
      return { ok: true, x: p.x, y: p.y, ...extra }
    }
  )

  handleTrusted(
    'computer:move',
    async (_e, x: number, y: number, opts?: { coordSpace?: string }) => {
      const p = resolvePoint(Number(x), Number(y), opts?.coordSpace)
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
      const a = resolvePoint(Number(fromX), Number(fromY), opts?.coordSpace)
      const b = resolvePoint(Number(toX), Number(toY), opts?.coordSpace)
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
      const p = resolvePoint(Number(x), Number(y), opts?.coordSpace)
      const res = await mouseScroll(p.x, p.y, { dy: opts?.dy, dx: opts?.dx })
      if (res.error) return res
      const extra = await maybeShot(opts?.returnScreenshot, opts?.displayId)
      return { ok: true, x: p.x, y: p.y, ...extra }
    }
  )

  handleTrusted('computer:type', async (_e, text: string, opts?: { returnScreenshot?: boolean }) => {
    const res = await typeText(String(text ?? ''))
    if (res.error) return res
    const extra = await maybeShot(opts?.returnScreenshot)
    return { ok: true, ...extra }
  })

  handleTrusted('computer:keypress', async (_e, key: string, opts?: { returnScreenshot?: boolean }) => {
    const res = await keypress(String(key ?? ''))
    if (res.error) return res
    const extra = await maybeShot(opts?.returnScreenshot)
    return { ok: true, ...extra }
  })

  handleTrusted('computer:clipboard', async (_e, action: string, text?: string) => {
    const a = String(action || 'get').toLowerCase()
    if (a === 'get' || a === 'read') return clipboardRead()
    if (a === 'set' || a === 'write') return clipboardWrite(String(text ?? ''))
    return { error: 'action must be get or set' }
  })

  handleTrusted('computer:wait', async (_e, ms: number) => {
    await sleep(Number(ms) || 0)
    return { ok: true, ms: Math.min(Math.max(0, Math.floor(Number(ms) || 0)), 60_000) }
  })
}
