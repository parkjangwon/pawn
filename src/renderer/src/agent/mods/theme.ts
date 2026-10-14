/**
 * Mod theming: CSS variable overrides and per-mod stylesheets.
 *
 * - `vars` override custom properties (`--name`) on the app root, per light/dark/both.
 * - `css` is a stylesheet wrapped in `@scope ([data-plugin="<mod>"])`, so it can only
 *   style the chrome that mod drew through `$.slot.*`.
 * Anything that could load a resource or escape the block is refused: `url(`, `@import`,
 * `image-set(`, `expression(`, `<`, and (for vars) `;{}`.
 */

export type ModThemeMode = 'light' | 'dark' | 'all'

export interface ModThemeEntry {
  plugin: string
  id: string
  kind: 'vars' | 'css'
  mode: ModThemeMode
  vars?: Record<string, string>
  css?: string
}

export const THEME_ID = /^[A-Za-z0-9_-]{1,64}$/
const VAR_NAME = /^--[A-Za-z0-9_-]{1,64}$/
const MAX_VARS = 128
const MAX_VALUE = 200
export const MAX_CSS = 32 * 1024

const BANNED = /url\s*\(|@import|image-set\s*\(|expression\s*\(|<|\\/i

export function sanitizeVars(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('theme vars must be an object of --name: value')
  }
  const out: Record<string, string> = {}
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length > MAX_VARS) throw new Error(`theme vars: at most ${MAX_VARS} variables`)
  for (const [rawName, rawValue] of entries) {
    const name = rawName.startsWith('--') ? rawName : `--${rawName}`
    if (!VAR_NAME.test(name)) throw new Error(`Invalid CSS variable name: ${rawName}`)
    const value = String(rawValue ?? '').trim()
    if (!value || value.length > MAX_VALUE) throw new Error(`Invalid value for ${name}`)
    if (/[;{}]/.test(value) || BANNED.test(value)) throw new Error(`Refused value for ${name}`)
    out[name] = value
  }
  return out
}

export function sanitizeCss(input: unknown): string {
  const css = String(input ?? '')
  if (css.length > MAX_CSS) throw new Error(`theme css: at most ${MAX_CSS} characters`)
  if (BANNED.test(css)) throw new Error('theme css refused: url(), @import, image-set(), expression(), "<" and "\\" are not allowed')
  // Braces must balance so the sheet can't close the @scope block and leak out.
  let depth = 0
  for (const ch of css) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) break
    }
  }
  if (depth !== 0) throw new Error('theme css refused: unbalanced braces')
  if (/\/\*/.test(css) && !/\*\//.test(css.slice(css.lastIndexOf('/*')))) {
    throw new Error('theme css refused: unterminated comment')
  }
  // Fixed/sticky boxes could float a fake dialog over trusted surfaces.
  if (/position\s*:\s*(fixed|sticky)/i.test(css)) {
    throw new Error('theme css refused: position fixed/sticky is not allowed')
  }
  if (/@(scope|layer|font-face|namespace|charset)\b/i.test(css)) {
    throw new Error('theme css refused: that at-rule is not allowed')
  }
  return css
}

function cssString(s: string): string {
  return s.replace(/["\\\n\r]/g, '')
}

/** Build the one stylesheet for every theme entry whose mod isn't switched off. */
export function buildModThemeCss(entries: ModThemeEntry[], off: readonly string[]): string {
  const offSet = new Set(off.map((n) => n.toLowerCase()))
  const parts: string[] = []
  for (const e of entries) {
    if (offSet.has(e.plugin.toLowerCase())) continue
    const tag = `/* mod ${cssString(e.plugin)} · ${cssString(e.id)} */`
    if (e.kind === 'vars' && e.vars) {
      const body = Object.entries(e.vars)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n')
      // Doubled .app beats the built-in `.app.light` / `.app.dark` palettes.
      const sel = e.mode === 'all' ? '.app.app:not(.mods-trusted)' : `.app.app.${e.mode}:not(.mods-trusted)`
      parts.push(`${tag}\n${sel} {\n${body}\n}`)
    } else if (e.kind === 'css' && e.css) {
      const scope = `[data-plugin="${cssString(e.plugin)}"]`
      const inner = e.mode === 'all' ? e.css : `:where(.app.${e.mode}) & { ${e.css} }`
      parts.push(`${tag}\n@scope (${scope}) {\n${inner}\n}`)
    }
  }
  return parts.join('\n\n')
}

const OFF_KEY = 'pawn.mods.themeOff'

export function loadThemeOff(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(OFF_KEY)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveThemeOff(off: string[]): void {
  try {
    globalThis.localStorage?.setItem(OFF_KEY, JSON.stringify(off))
  } catch {
    /* ignore */
  }
}
