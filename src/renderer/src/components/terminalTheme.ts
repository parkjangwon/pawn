import type { ITheme } from '@xterm/xterm'

/**
 * ZCode homage (terminalTheme.ts): derive the xterm theme from pawn's CSS
 * tokens at runtime so the terminal follows light/dark automatically.
 * xterm cannot parse `var()` / `color-mix()`, so token values are resolved
 * through the browser and normalized to `rgba()` strings via canvas.
 */

const TOKEN_FALLBACKS = {
  background: ['--bg-secondary', '#161616'],
  foreground: ['--text-primary', '#d4d4d4'],
  cursor: ['--text-primary', '#d4d4d4'],
  selectionBackground: ['--text-muted', 'rgba(115, 115, 115, 0.35)']
} satisfies Partial<Record<keyof ITheme, readonly [string, string]>>

// Palette for the dark canvas (#161616): brighter ANSI hues.
const ANSI_DARK: ITheme = {
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

// Palette for the light canvas (#ffffff): darkened ANSI hues so output
// written in each color stays readable without the dark-theme glow.
const ANSI_LIGHT: ITheme = {
  black: '#262626',
  red: '#c62828',
  green: '#1e8a3e',
  yellow: '#9a6b00',
  blue: '#1565c0',
  magenta: '#8e24aa',
  cyan: '#00838f',
  white: '#8a8a8a',
  brightBlack: '#6b6b6b',
  brightRed: '#c62828',
  brightGreen: '#1e8a3e',
  brightYellow: '#9a6b00',
  brightBlue: '#1565c0',
  brightMagenta: '#8e24aa',
  brightCyan: '#00838f',
  brightWhite: '#a5a5a5'
}

let probeEl: HTMLSpanElement | null = null
let normalizeCtx: CanvasRenderingContext2D | null | undefined

/** Element whose class list scopes pawn tokens (.app.light / .app.dark). */
export function getThemeScopeElement(): Element | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('.app') ?? document.documentElement
}

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
  const scope = getThemeScopeElement()
  const rootStyle = scope ? getComputedStyle(scope) : null
  const themed = Object.fromEntries(
    Object.entries(TOKEN_FALLBACKS).map(([key, [token, fallback]]) => {
      const raw = rootStyle?.getPropertyValue(token).trim() || fallback
      return [key, normalizeCssColor(raw, fallback)]
    })
  ) as ITheme
  const ansi = scope?.classList.contains('light') ? ANSI_LIGHT : ANSI_DARK
  return { ...themed, ...ansi }
}
