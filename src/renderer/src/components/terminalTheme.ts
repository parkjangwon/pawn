import type { ITheme } from '@xterm/xterm'

/**
 * ZCode homage (terminalTheme.ts): derive the xterm theme from pawn's CSS
 * tokens at runtime so the terminal follows light/dark automatically.
 * xterm cannot parse `var()` / `color-mix()`, so token values are resolved
 * through the browser and normalized to `rgba()` strings via canvas.
 */

const TOKEN_FALLBACKS = {
  background: ['--bg-primary', '#161616'],
  foreground: ['--text-primary', '#d4d4d4'],
  cursor: ['--text-primary', '#d4d4d4'],
  selectionBackground: ['--text-muted', 'rgba(115, 115, 115, 0.35)']
} satisfies Partial<Record<keyof ITheme, readonly [string, string]>>

const ANSI: ITheme = {
  black: '#1e1e1e',
  red: '#e34c4c',
  green: '#4caf50',
  yellow: '#ffc107',
  blue: '#2196f3',
  magenta: '#9c27b0',
  cyan: '#00bcd4',
  white: '#d4d4d4',
  brightBlack: '#666666',
  brightRed: '#e34c4c',
  brightGreen: '#4caf50',
  brightYellow: '#ffc107',
  brightBlue: '#2196f3',
  brightMagenta: '#9c27b0',
  brightCyan: '#00bcd4',
  brightWhite: '#ffffff'
}

let probeEl: HTMLSpanElement | null = null
let normalizeCtx: CanvasRenderingContext2D | null | undefined

function getProbe(): HTMLSpanElement | null {
  if (typeof document === 'undefined') return null
  if (!probeEl) probeEl = document.createElement('span')
  return probeEl
}

function getNormalizeCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (normalizeCtx === undefined) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) ctx.globalCompositeOperation = 'copy'
      normalizeCtx = ctx
    } catch {
      normalizeCtx = null
    }
  }
  return normalizeCtx
}

function normalizeCssColor(raw: string, fallback: string): string {
  const el = getProbe()
  const ctx = getNormalizeCtx()
  if (!el || !ctx || !document.body) return raw || fallback
  try {
    document.body.appendChild(el)
    el.style.color = ''
    el.style.color = raw
    const resolved = getComputedStyle(el).color
    ctx.fillStyle = '#000000'
    ctx.fillStyle = resolved
    ctx.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data
    return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`
  } catch {
    return fallback
  } finally {
    el.remove()
  }
}

/** Read pawn tokens and return an xterm-parseable theme. */
export function readPawnTerminalTheme(): ITheme {
  const rootStyle =
    typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  const themed = Object.fromEntries(
    Object.entries(TOKEN_FALLBACKS).map(([key, [token, fallback]]) => {
      const raw = rootStyle?.getPropertyValue(token).trim() || fallback
      return [key, normalizeCssColor(raw, fallback)]
    })
  ) as ITheme
  return { ...themed, ...ANSI }
}
