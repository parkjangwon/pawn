/**
 * Guards the design-token discipline established in the 2026-10 UX overhaul:
 *  - every z-index goes through the --z-* scale (no raw numbers, no ad-hoc
 *    stacking values like the old 999999 tooltip)
 *  - the hardcoded status-color palette that broke light-theme contrast
 *    (6 greens, 5 reds, 7 ambers, off-brand orange, stray blue) never returns
 *    — semantic colors must use --success / --danger / --warning / --primary.
 * Intentional literal-color surfaces (hljs syntax palettes, code-block base,
 * terminal) stay allowed because they are scoped and theme-deliberate.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..', '..')

function cssFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.css')) files.push(p)
    }
  }
  walk(join(root, 'components'))
  walk(join(root, 'styles'))
  return files
}

const BANNED_STATUS_HEX =
  /#(22c55e|16a34a|3ecf8e|2a9d5c|3fb950|10b981|4caf50|ef4444|f85149|f87171|ff8a8a|f59e0b|d4a017|c47b00|f5a524|a67c00|ffc107|d97706|0d9488|3b82f6|ff8a3d|6c8cff)\b/i

describe('design token discipline', () => {
  it('every z-index uses the --z-* scale (var/calc only)', () => {
    const hits: string[] = []
    for (const f of cssFiles()) {
      const src = readFileSync(f, 'utf8')
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        const m = /z-index:\s*([^;]+);/.exec(line)
        if (!m) return
        const value = m[1].trim()
        if (!/^(var\(--z-|calc\(var\(--z-)/.test(value)) {
          hits.push(`${f.split('src/renderer/src/')[1]}:${i + 1} z-index: ${value}`)
        }
      })
    }
    expect(hits).toEqual([])
  })

  it('no hardcoded status colors (use --success/--danger/--warning/--primary)', () => {
    const hits: string[] = []
    for (const f of cssFiles()) {
      const src = readFileSync(f, 'utf8')
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        if (BANNED_STATUS_HEX.test(line)) {
          hits.push(`${f.split('src/renderer/src/')[1]}:${i + 1}`)
        }
      })
    }
    expect(hits).toEqual([])
  })
})
