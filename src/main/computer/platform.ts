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
