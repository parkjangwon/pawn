import { desktopCapturer } from 'electron'
import { allDisplays, findDisplay, fitThumbnail, logicalSize, scaleFactor } from './platform'

export interface ScreenshotResult {
  dataUrl?: string
  error?: string
  width?: number
  height?: number
  screenWidth?: number
  screenHeight?: number
  scaleFactor?: number
  displayId?: number
  displayLabel?: string
  displays?: Array<{ id: number; label: string; width: number; height: number; primary: boolean }>
}

export async function takeScreenshot(opts?: {
  displayId?: number | null
  maxWidth?: number
}): Promise<ScreenshotResult> {
  try {
    const display = findDisplay(opts?.displayId)
    const logical = logicalSize(display)
    const thumb = fitThumbnail(logical.width, logical.height, opts?.maxWidth ?? 1600)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumb.width, height: thumb.height }
    })
    if (!sources.length) return { error: 'No screen sources available (check Screen Recording permission on macOS).' }

    // Prefer source matching display id when Electron tags it
    const idStr = String(display.id)
    let source =
      sources.find((s) => s.display_id && String(s.display_id) === idStr) ||
      sources.find((s) => s.id.includes(idStr)) ||
      sources[0]

    // Multi-display: if user asked for non-primary and we only got one source, still use it
    if (opts?.displayId != null && sources.length > 1) {
      const displays = allDisplays()
      const idx = displays.findIndex((d) => d.id === display.id)
      if (idx >= 0 && sources[idx]) source = sources[idx]
    }

    const primary = findDisplay(null)
    const displays = allDisplays().map((d) => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      width: d.size.width,
      height: d.size.height,
      primary: d.id === primary.id
    }))

    return {
      dataUrl: source.thumbnail.toDataURL(),
      width: thumb.width,
      height: thumb.height,
      screenWidth: logical.width,
      screenHeight: logical.height,
      scaleFactor: scaleFactor(display),
      displayId: display.id,
      displayLabel: display.label || `Display ${display.id}`,
      displays
    }
  } catch (err) {
    return {
      error: `${String(err)}. On macOS grant Screen Recording to Pawn (System Settings → Privacy & Security).`
    }
  }
}

export function listDisplays(): ScreenshotResult['displays'] {
  const primary = findDisplay(null)
  return allDisplays().map((d) => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primary.id
  }))
}
