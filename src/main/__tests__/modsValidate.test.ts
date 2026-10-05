import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatValidateReport, validateModDirectory } from '../mods/validate'
import { inspectModDir } from '../mods/discover'
import { stripTypeScript } from '../mods/load'
import { fileURLToPath } from 'url'

const EXAMPLE_FIRST_MOD = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'examples/mods/first-mod'
)

const dirs: string[] = []

function withDollar(src: string): string {
  return src.replace(/__API__/g, '$')
}

function tempMod(registerBody: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pawn-mod-'))
  dirs.push(root)
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  mkdirSync(join(root, 'hooks'), { recursive: true })
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'sample-mod', version: '0.1.0', description: 'test' })
  )
  writeFileSync(
    join(root, 'hooks', 'hooks.json'),
    JSON.stringify({ modules: ['./register.js'] })
  )
  writeFileSync(join(root, 'hooks', 'register.js'), registerBody)
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('mods validate / discover', () => {
  it('discovers a Claude Code shaped mod directory', () => {
    const root = tempMod(
      withDollar(
        [
          'export function register(on) {',
          "  on('session.start', async (__API__, e, next) => next(e))",
          "  on('tool.call', async (__API__, e, next) => next(e))",
          '}'
        ].join('\n')
      )
    )
    const mod = inspectModDir(root, { tier: 'user', source: 'plugin-dir', enabled: true, consented: true })
    expect(mod?.name).toBe('sample-mod')
    expect(mod?.moduleRelative).toMatch(/register\.js$/)
  })

  it('lists hooks and calls like claude plugin validate', () => {
    const root = tempMod(
      withDollar(
        [
          'export function register(on) {',
          "  on('session.start', async (__API__, e, next) => {",
          "    await __API__.command.register({ name: 'tally', description: 'count' })",
          '    return next(e)',
          '  })',
          "  on('tool.call', async (__API__, e, next) => {",
          "    __API__.ui.invalidate('ui.render')",
          '    return next(e)',
          '  })',
          "  on('command.run', { command: 'tally' }, async () => ({ text: 'ok' }))",
          "  on('ui.render', { component: 'Spinner' }, async (__API__, e, next) => next(e))",
          '}'
        ].join('\n')
      )
    )
    const report = validateModDirectory(root)
    expect(report.ok).toBe(true)
    expect(report.hooks.some((h) => h.startsWith('session.start'))).toBe(true)
    expect(report.hooks.some((h) => h.includes('command.run'))).toBe(true)
    expect(report.calls).toContain('$.command.register')
    expect(report.calls).toContain('$.ui.invalidate')
    const text = formatValidateReport(report)
    expect(text).toContain('Validation passed')
  })

  it('rejects unknown events and require()', () => {
    const root = tempMod(
      [
        'export function register(on) {',
        "  const x = require('fs')",
        "  on('tool.calls', async () => {})",
        '}'
      ].join('\n')
    )
    const report = validateModDirectory(root)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.message.includes('require'))).toBe(true)
    expect(report.findings.some((f) => f.message.includes('tool.calls'))).toBe(true)
  })

  it('validates examples/mods/first-mod', () => {
    const report = validateModDirectory(EXAMPLE_FIRST_MOD)
    expect(report.ok).toBe(true)
    expect(report.hooks.some((h) => h.includes('tool.call'))).toBe(true)
    expect(report.hooks.some((h) => h.includes('command.run'))).toBe(true)
    expect(report.calls).toContain('$.command.register')
  })

  it('strips light TypeScript from hooks modules', () => {
    const out = stripTypeScript(
      [
        "import type { Foo } from './x'",
        'export function register(on: ModOn): void {',
        "  on('tool.call', async (api: ModsApi, e: any, next: any) => next(e as ToolCall))",
        '}'
      ].join('\n')
    )
    expect(out).not.toContain('import type')
    expect(out).toContain('export function register(on)')
    expect(out).not.toContain(' as ToolCall')
  })
})
