import { existsSync, readFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { inspectModDir } from './discover'
import type { ModValidateFinding, ModValidateReport } from './types'

/** Known Claude Code / Pawn mod events (subset; unknown names are errors). */
const KNOWN_EVENTS = new Set([
  'tool.call',
  'tool.check',
  'tool.describe',
  'prompt.submit',
  'prompt.fill',
  'prompt.suggest',
  'prompt.edit',
  'prompt.compose',
  'prompt.section',
  'prompt.context',
  'prompt.attachment',
  'skill.prompt',
  'attribution.text',
  'command.run',
  'command.describe',
  'config.set',
  'config.describe',
  'turn.start',
  'turn.step',
  'turn.complete',
  'session.start',
  'session.end',
  'session.compact',
  'session.receive',
  'session.send',
  'session.append',
  'session.attach',
  'session.detach',
  'session.measure',
  'agent.offer',
  'agent.spawn',
  'ui.render',
  'ui.resolve',
  'ui.press',
  'ui.input',
  'ui.select',
  'ui.focus',
  'ui.scroll',
  'ui.close',
  'ui.message',
  'ui.fault',
  'plugin.register',
  'engine.create',
  'telemetry.log',
  'telemetry.mark',
  'classic.SessionStart',
  'classic.SessionEnd',
  'classic.UserPromptSubmit',
  'classic.PreToolUse',
  'classic.PostToolUse',
  'classic.Stop',
  'classic.PermissionRequest',
  'fs.read',
  'fs.write',
  'fs.list',
  'fs.exists',
  'fs.stat',
  'http.fetch',
  'process.run',
  'process.spawn',
  'model.complete',
  'model.fork',
  'ui.open',
  'ui.invalidate',
  'ui.toast',
  'ui.status',
  'ui.log',
  'command.register',
  'tool.register',
  'store.get',
  'store.set'
])

function matcherLabel(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '{}') return ''
  try {
    const obj = Function(`"use strict"; return (${trimmed})`)() as Record<string, unknown>
    const parts = Object.entries(obj).map(([k, v]) => `${k}=${String(v)}`)
    return parts.length ? `{${parts.join(',')}}` : ''
  } catch {
    return trimmed.replace(/\s+/g, '')
  }
}

/**
 * Static analysis of a hooks module — mirrors `claude plugin validate` output shape.
 * Does not execute the module.
 */
export function validateModDirectory(dir: string): ModValidateReport {
  const findings: ModValidateFinding[] = []
  const root = dir.trim()
  if (!root || !existsSync(root)) {
    return {
      ok: false,
      hooks: [],
      calls: [],
      envReads: [],
      envWrites: [],
      findings: [{ severity: 'error', message: `Directory not found: ${dir}` }]
    }
  }

  const mod = inspectModDir(root, { tier: 'user', source: 'plugin-dir', enabled: true, consented: true })
  if (!mod) {
    // Helpful diagnostics
    const hasManifest =
      existsSync(join(root, '.claude-plugin', 'plugin.json')) ||
      existsSync(join(root, '.pawn-plugin', 'plugin.json'))
    const hooksJson = join(root, 'hooks', 'hooks.json')
    if (!hasManifest) {
      findings.push({
        severity: 'error',
        message: 'Missing .claude-plugin/plugin.json (or .pawn-plugin/plugin.json)'
      })
    }
    if (!existsSync(hooksJson)) {
      findings.push({ severity: 'error', message: 'Missing hooks/hooks.json' })
    } else {
      try {
        const hj = JSON.parse(readFileSync(hooksJson, 'utf-8')) as { modules?: unknown }
        if (!Array.isArray(hj.modules) || hj.modules.length === 0) {
          findings.push({
            severity: 'error',
            message: 'hooks/hooks.json must include a non-empty "modules" array',
            file: 'hooks/hooks.json'
          })
        } else {
          findings.push({
            severity: 'error',
            message: `hooks module not found: ${String(hj.modules[0])}`,
            file: 'hooks/hooks.json'
          })
        }
      } catch {
        findings.push({ severity: 'error', message: 'hooks/hooks.json is not valid JSON', file: 'hooks/hooks.json' })
      }
    }
    return { ok: false, hooks: [], calls: [], envReads: [], envWrites: [], findings }
  }

  let source = ''
  try {
    source = readFileSync(mod.modulePath, 'utf-8')
  } catch (err) {
    findings.push({
      severity: 'error',
      message: `Cannot read hooks module: ${err instanceof Error ? err.message : String(err)}`,
      file: mod.moduleRelative
    })
    return {
      ok: false,
      mod: { name: mod.name, root: mod.root, moduleRelative: mod.moduleRelative },
      hooks: [],
      calls: [],
      envReads: [],
      envWrites: [],
      findings
    }
  }

  if (/\brequire\s*\(/.test(source)) {
    findings.push({
      severity: 'error',
      message: 'Use import declarations; require() is not allowed in a hooks module',
      file: mod.moduleRelative
    })
  }
  if (/\bimport\s*\(/.test(source)) {
    findings.push({
      severity: 'error',
      message: 'a dynamic import(); a hooks module imports its own files with an import declaration',
      file: mod.moduleRelative
    })
  }

  const hooks: string[] = []
  const onRe = /\bon\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[\s\S]*?\})\s*)?,/g
  let m: RegExpExecArray | null
  while ((m = onRe.exec(source))) {
    const event = m[1]
    if (!KNOWN_EVENTS.has(event) && !event.startsWith('classic.')) {
      findings.push({
        severity: 'error',
        message: `"${event}" is not an event`,
        file: mod.moduleRelative
      })
    }
    const filter = matcherLabel(m[2])
    hooks.push(filter ? `${event}${filter}` : event)
  }

  if (!/\bexport\s+(async\s+)?function\s+register\b|\bexport\s*\{[^}]*\bregister\b/.test(source)) {
    findings.push({
      severity: 'error',
      message: 'Hooks module must export function register(on, options?)',
      file: mod.moduleRelative
    })
  }

  const calls = new Set<string>()
  const callRe = /\$\.([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)/g
  while ((m = callRe.exec(source))) {
    calls.add(`$.${m[1]}.${m[2]}`)
  }

  const envReads = new Set<string>()
  const envWrites = new Set<string>()
  const envGetRe = /\$\.env\.get\(\s*['"]([^'"]+)['"]/g
  while ((m = envGetRe.exec(source))) envReads.add(m[1])
  const envSetRe = /\$\.env\.set\(\s*['"]([^'"]+)['"]/g
  while ((m = envSetRe.exec(source))) envWrites.add(m[1])

  const errors = findings.filter((f) => f.severity === 'error')
  return {
    ok: errors.length === 0,
    mod: { name: mod.name, root: mod.root, moduleRelative: mod.moduleRelative },
    hooks: Array.from(new Set(hooks)),
    calls: Array.from(calls).sort(),
    envReads: Array.from(envReads).sort(),
    envWrites: Array.from(envWrites).sort(),
    findings
  }
}

export function formatValidateReport(report: ModValidateReport): string {
  const lines: string[] = []
  if (report.mod) {
    lines.push(`  ❯ ./${report.mod.moduleRelative} hooks: ${report.hooks.join(', ') || '(none)'}`)
    lines.push(`  ❯ ./${report.mod.moduleRelative} calls: ${report.calls.join(', ') || '(none)'}`)
    if (report.envReads.length) {
      lines.push(`  ❯ ./${report.mod.moduleRelative} env reads: ${report.envReads.join(', ')}`)
    }
    if (report.envWrites.length) {
      lines.push(`  ❯ ./${report.mod.moduleRelative} env writes: ${report.envWrites.join(', ')}`)
    }
  }
  for (const f of report.findings) {
    lines.push(`  ${f.severity === 'error' ? '✖' : '⚠'} ${f.message}${f.file ? ` (${f.file})` : ''}`)
  }
  lines.push(report.ok ? '✔ Validation passed' : '✖ Validation failed')
  return lines.join('\n')
}

/** Validate by path; if path is a file, use its parent plugin root. */
export function validateModPath(path: string): ModValidateReport {
  const p = path.trim()
  if (existsSync(p) && p.endsWith('register.js')) {
    return validateModDirectory(dirname(dirname(p)))
  }
  if (basename(p) === 'hooks' && existsSync(join(p, 'hooks.json'))) {
    return validateModDirectory(dirname(p))
  }
  return validateModDirectory(p)
}
