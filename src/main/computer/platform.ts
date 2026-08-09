import { screen, type Display } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const EXEC_TIMEOUT_MS = 20_000

export async function run(
  file: string,
  args: string[],
  opts?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, {
    timeout: opts?.timeout ?? EXEC_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024
  }) as Promise<{ stdout: string; stderr: string }>
}

export function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT')
}

export function primaryDisplay(): Display {
  return screen.getPrimaryDisplay()
}

export function allDisplays(): Display[] {
  return screen.getAllDisplays()
}

export function findDisplay(id?: number | null): Display {
  if (id == null) return primaryDisplay()
  return allDisplays().find((d) => d.id === id) || primaryDisplay()
}

/** Logical (DIP) size used for coordinate space. */
export function logicalSize(d: Display): { width: number; height: number } {
  return { width: d.size.width, height: d.size.height }
}

export function scaleFactor(d: Display): number {
  return d.scaleFactor || 1
}

/** Convert image-space coords (from screenshot) to OS logical coords. */
export function imageToLogical(
  x: number,
  y: number,
  meta: { imageWidth: number; imageHeight: number; screenWidth: number; screenHeight: number }
): { x: number; y: number } {
  const sx = meta.screenWidth / Math.max(1, meta.imageWidth)
  const sy = meta.screenHeight / Math.max(1, meta.imageHeight)
  return {
    x: Math.round(x * sx),
    y: Math.round(y * sy)
  }
}

/** Clamp logical coords into a display's bounds (prevents off-screen clicks). */
export function clampLogicalPoint(
  x: number,
  y: number,
  d?: Display
): { x: number; y: number; clamped: boolean } {
  const display = d || primaryDisplay()
  const { width, height } = logicalSize(display)
  const bounds = display.bounds
  const minX = bounds?.x ?? 0
  const minY = bounds?.y ?? 0
  const maxX = minX + width - 1
  const maxY = minY + height - 1
  const cx = Math.min(maxX, Math.max(minX, Math.round(x)))
  const cy = Math.min(maxY, Math.max(minY, Math.round(y)))
  return { x: cx, y: cy, clamped: cx !== Math.round(x) || cy !== Math.round(y) }
}

/** One-shot dependency / platform readiness for computer use. */
export async function computerPreflight(): Promise<{
  ok: boolean
  platform: string
  notes: string[]
  errors: string[]
}> {
  const platform = process.platform
  const notes: string[] = []
  const errors: string[] = []
  try {
    const displays = allDisplays()
    notes.push(`displays=${displays.length} primary=${primaryDisplay().id}`)
  } catch (e) {
    errors.push(`display enumeration failed: ${String(e)}`)
  }
  if (platform === 'darwin') {
    try {
      await run('cliclick', ['-h'])
      notes.push('cliclick: available')
    } catch (err) {
      if (isEnoent(err)) {
        errors.push(
          'cliclick missing — brew install cliclick; enable Accessibility for Pawn'
        )
      } else {
        notes.push(`cliclick: present (help exit ${String(err).slice(0, 40)})`)
      }
    }
  } else if (platform === 'linux') {
    try {
      await run('xdotool', ['version'])
      notes.push('xdotool: available')
    } catch (err) {
      if (isEnoent(err)) errors.push('xdotool missing — install xdotool for mouse/keyboard')
      else notes.push('xdotool: check failed')
    }
  } else if (platform === 'win32') {
    notes.push('windows: PowerShell mouse/keyboard path')
  }
  return { ok: errors.length === 0, platform, notes, errors }
}

/** Fit screenshot dimensions for model vision (preserve aspect). */
export function fitThumbnail(
  screenW: number,
  screenH: number,
  maxWidth: number
): { width: number; height: number } {
  const maxW = Math.max(320, Math.min(maxWidth || 1600, 2560))
  if (screenW <= maxW) return { width: screenW, height: screenH }
  const scale = maxW / screenW
  return {
    width: maxW,
    height: Math.max(1, Math.round(screenH * scale))
  }
}

export type MouseButton = 'left' | 'right' | 'middle'

export function normalizeButton(raw?: string): MouseButton {
  const b = String(raw || 'left').toLowerCase()
  if (b === 'right' || b === '2' || b === 'secondary') return 'right'
  if (b === 'middle' || b === '3' || b === 'center') return 'middle'
  return 'left'
}

/** Parse "cmd+shift+t", "ctrl+c", "Return", "enter" into parts. */
export function parseKeyCombo(raw: string): { modifiers: string[]; key: string } {
  const s = String(raw || '').trim()
  if (!s) return { modifiers: [], key: '' }
  const parts = s.split(/[+\-]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 1) return { modifiers: [], key: parts[0] }
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1).map(normalizeModifier)
  return { modifiers, key }
}

export function normalizeModifier(m: string): string {
  const l = m.toLowerCase()
  if (l === 'cmd' || l === 'command' || l === '⌘' || l === 'meta' || l === 'win' || l === 'super') {
    return process.platform === 'darwin' ? 'command' : 'super'
  }
  if (l === 'ctrl' || l === 'control' || l === '⌃') return 'control'
  if (l === 'alt' || l === 'option' || l === 'opt' || l === '⌥') return 'alt'
  if (l === 'shift' || l === '⇧') return 'shift'
  return l
}

export function sleep(ms: number): Promise<void> {
  const n = Math.min(Math.max(0, Math.floor(ms)), 60_000)
  return new Promise((r) => setTimeout(r, n))
}
