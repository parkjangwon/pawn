/**
 * Repo onboarding profile — how to work in this repository, learned once and
 * kept up to date: stack, package manager, the build / test / lint commands
 * (and whether they were seen to work), conventions and gotchas.
 *
 * Detection runs on the first turn in a project; commands the agent runs
 * successfully are recorded as verified (with duration); notes come from the
 * agent (project_profile) and from user corrections. A short block is
 * injected into the project preamble at the start of every turn.
 *
 * Stored per project root under ~/.pawn/profiles (never inside the repo).
 */

import { detectCheckCommands } from './runChecks'

export type CommandKind = 'install' | 'build' | 'typecheck' | 'test' | 'lint' | 'format' | 'dev'

export interface ProfileCommand {
  command: string
  source: 'detected' | 'learned' | 'user'
  verified?: boolean
  lastOkAt?: number
  lastFailAt?: number
  durationMs?: number
  failures?: number
}

export interface RepoProfile {
  version: 1
  root: string
  detectedAt: number
  updatedAt: number
  stack: string[]
  packageManager?: string
  commands: Partial<Record<CommandKind, ProfileCommand>>
  conventions: string[]
  notes: string[]
}

export const COMMAND_KINDS: CommandKind[] = ['install', 'build', 'typecheck', 'test', 'lint', 'format', 'dev']
const MAX_NOTES = 30

const cache = new Map<string, RepoProfile>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function exists(p: string): Promise<boolean> {
  try {
    return Boolean(await window.api.fs.exists(p))
  } catch {
    return false
  }
}

async function readJson(p: string): Promise<Record<string, any> | null> {
  const r = await window.api.fs.readFile(p).catch(() => null)
  if (typeof r !== 'string') return null
  try {
    return JSON.parse(r)
  } catch {
    return null
  }
}

/** Fresh profile from the files at `root`. */
export async function detectProfile(root: string): Promise<RepoProfile> {
  const r = root.replace(/\/$/, '')
  const stack: string[] = []
  const conventions: string[] = []
  const commands: RepoProfile['commands'] = {}
  let packageManager: string | undefined

  const pkg = await readJson(`${r}/package.json`)
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } as Record<string, unknown>
    const has = (n: string): boolean => n in deps
    stack.push(has('typescript') || (await exists(`${r}/tsconfig.json`)) ? 'TypeScript' : 'JavaScript')
    for (const [dep, label] of [
      ['react', 'React'], ['next', 'Next.js'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['electron', 'Electron'],
      ['express', 'Express'], ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'], ['vite', 'Vite'],
      ['vitest', 'Vitest'], ['jest', 'Jest'], ['playwright', 'Playwright'], ['@playwright/test', 'Playwright'],
      ['tailwindcss', 'Tailwind'], ['prisma', 'Prisma'], ['zustand', 'Zustand']
    ] as const) {
      if (has(dep) && !stack.includes(label)) stack.push(label)
    }
    packageManager = (await exists(`${r}/pnpm-lock.yaml`))
      ? 'pnpm'
      : (await exists(`${r}/yarn.lock`))
        ? 'yarn'
        : (await exists(`${r}/bun.lockb`)) || (await exists(`${r}/bun.lock`))
          ? 'bun'
          : 'npm'
    commands.install = { command: packageManager === 'yarn' ? 'yarn install' : `${packageManager} install`, source: 'detected' }
    const scripts = (pkg.scripts || {}) as Record<string, unknown>
    const run = (s: string): string => (packageManager === 'npm' ? `npm run ${s}` : packageManager === 'yarn' ? `yarn ${s}` : `${packageManager} run ${s}`)
    for (const [kind, names] of [
      ['dev', ['dev', 'start', 'serve']],
      ['format', ['format', 'fmt', 'prettier']]
    ] as const) {
      const hit = names.find((n) => typeof scripts[n] === 'string')
      if (hit) commands[kind] = { command: run(hit), source: 'detected' }
    }
    if (pkg.type === 'module') conventions.push('ESM package ("type": "module")')
  }
  if (await exists(`${r}/pyproject.toml`)) stack.push('Python')
  if (await exists(`${r}/go.mod`)) stack.push('Go')
  if (await exists(`${r}/Cargo.toml`)) stack.push('Rust')
  if (await exists(`${r}/Gemfile`)) stack.push('Ruby')
  if ((await exists(`${r}/pom.xml`)) || (await exists(`${r}/build.gradle`)) || (await exists(`${r}/build.gradle.kts`))) stack.push('JVM')
  try {
    for (const d of await detectCheckCommands(r)) {
      if (!commands[d.kind]) commands[d.kind] = { command: d.command, source: 'detected' }
    }
  } catch {
    /* detection optional */
  }
  for (const [file, note] of [
    ['.editorconfig', '.editorconfig present — follow its indentation'],
    ['.prettierrc', 'Prettier formatting'],
    ['.prettierrc.json', 'Prettier formatting'],
    ['biome.json', 'Biome lint/format'],
    ['eslint.config.js', 'ESLint (flat config)'],
    ['.eslintrc.json', 'ESLint'],
    ['ruff.toml', 'Ruff lint'],
    ['CLAUDE.md', 'CLAUDE.md has project instructions'],
    ['AGENTS.md', 'AGENTS.md has project instructions'],
    ['.github/workflows', 'CI in .github/workflows']
  ] as const) {
    if ((await exists(`${r}/${file}`)) && !conventions.includes(note)) conventions.push(note)
  }
  const now = Date.now()
  return { version: 1, root: r, detectedAt: now, updatedAt: now, stack, packageManager, commands, conventions, notes: [] }
}

function parseProfile(json: string | null, root: string): RepoProfile | null {
  if (!json) return null
  try {
    const p = JSON.parse(json) as RepoProfile
    if (p && p.version === 1 && p.root && typeof p.commands === 'object') return { ...p, root }
  } catch {
    /* corrupt → re-detect */
  }
  return null
}

/** Load (or detect and store) the profile for `root`. */
export async function loadProfile(root: string): Promise<RepoProfile | null> {
  const r = root.replace(/\/$/, '')
  const hit = cache.get(r)
  if (hit) return hit
  const api = window.api?.profile
  if (!api) return null
  const stored = parseProfile((await api.get(r).catch(() => ({ json: null }))).json, r)
  // Re-detect weekly so new scripts show up; learned data is merged back in.
  let profile = stored
  if (!profile || Date.now() - profile.detectedAt > 7 * 24 * 60 * 60 * 1000) {
    const fresh = await detectProfile(r)
    profile = stored ? mergeDetected(stored, fresh) : fresh
    cache.set(r, profile)
    scheduleSave(profile, 0)
  } else {
    cache.set(r, profile)
  }
  return profile
}

function mergeDetected(old: RepoProfile, fresh: RepoProfile): RepoProfile {
  const commands = { ...fresh.commands }
  for (const k of COMMAND_KINDS) {
    const prev = old.commands[k]
    if (prev && (prev.source !== 'detected' || prev.verified || !commands[k])) commands[k] = prev
  }
  return { ...fresh, commands, notes: old.notes, conventions: Array.from(new Set([...fresh.conventions, ...old.conventions])).slice(0, 20) }
}

function scheduleSave(profile: RepoProfile, delay = 1500): void {
  const prev = saveTimers.get(profile.root)
  if (prev) clearTimeout(prev)
  saveTimers.set(
    profile.root,
    setTimeout(() => {
      saveTimers.delete(profile.root)
      void window.api?.profile?.save(profile.root, JSON.stringify(profile)).catch(() => {})
    }, delay)
  )
}

export function updateProfile(root: string, fn: (p: RepoProfile) => void): RepoProfile | null {
  const p = cache.get(root.replace(/\/$/, ''))
  if (!p) return null
  fn(p)
  p.updatedAt = Date.now()
  scheduleSave(p)
  return p
}

/** Which kind of project command `command` is, if any. */
export function classifyCommand(command: string): CommandKind | null {
  const c = command.trim().replace(/\s+/g, ' ')
  if (/^(npm|pnpm|yarn|bun) (ci|install|i)\b|^pip install -r|^poetry install|^uv sync|^bundle install|^go mod download/.test(c)) return 'install'
  if (/(^|[\s/])tsc(\s|$)|\b(typecheck|type-check|mypy|pyright)\b/.test(c)) return 'typecheck'
  if (/\b(vitest|jest|mocha|pytest|go test|cargo test|rspec|phpunit|playwright test|npm (run )?test|pnpm (run )?test|yarn test|bun test|make test)\b/.test(c)) return 'test'
  if (/\b(eslint|ruff( check)?|golangci-lint|clippy|rubocop|biome (check|lint)|npm run lint|pnpm (run )?lint|yarn lint)\b/.test(c)) return 'lint'
  if (/\b(prettier|black|gofmt|rustfmt|biome format|npm run format)\b/.test(c)) return 'format'
  if (/\b(npm run build|pnpm (run )?build|yarn build|go build|cargo build|make( build)?$|vite build|next build|tsc -b)\b/.test(c)) return 'build'
  return null
}

/**
 * Learn from a command the agent ran: mark the profile command verified /
 * failing, or adopt a new working command for its kind. Test runs scoped to
 * a few files don't replace the project-wide command.
 */
export function learnFromCommand(root: string, command: string, result: { exitCode: number | null; durationMs?: number; notFound?: boolean }): void {
  const kind = classifyCommand(command)
  if (!kind) return
  const cmd = command.trim().replace(/\s+/g, ' ')
  updateProfile(root, (p) => {
    const cur = p.commands[kind]
    const ok = result.exitCode === 0
    const same = cur && (cur.command === cmd || cmd.startsWith(`${cur.command} `))
    if (cur && same) {
      if (ok) {
        cur.verified = true
        cur.lastOkAt = Date.now()
        if (result.durationMs && cmd === cur.command) cur.durationMs = result.durationMs
        cur.failures = 0
      } else {
        cur.lastFailAt = Date.now()
        cur.failures = (cur.failures || 0) + 1
        // "command not found" means the recorded command is wrong for this machine.
        if (result.notFound) cur.verified = false
      }
      return
    }
    const scoped = /\.(test|spec)\.|_test\.|test_\w+\.py|::|-t |--grep|-k /.test(cmd)
    if (ok && !scoped && (!cur || (!cur.verified && cur.source === 'detected'))) {
      p.commands[kind] = { command: cmd, source: 'learned', verified: true, lastOkAt: Date.now(), ...(result.durationMs ? { durationMs: result.durationMs } : {}) }
    }
  })
}

export function addProfileNote(root: string, note: string): boolean {
  const text = note.trim().replace(/\s+/g, ' ').slice(0, 300)
  if (!text) return false
  let added = false
  updateProfile(root, (p) => {
    if (p.notes.some((n) => n.toLowerCase() === text.toLowerCase())) return
    p.notes.push(text)
    if (p.notes.length > MAX_NOTES) p.notes.splice(0, p.notes.length - MAX_NOTES)
    added = true
  })
  return added
}

function fmtDuration(ms?: number): string {
  if (!ms) return ''
  return ms < 60_000 ? ` ~${Math.max(1, Math.round(ms / 1000))}s` : ` ~${Math.round(ms / 60_000)}m`
}

/** Compact preamble block (≤ ~1.5k chars). */
export function formatProfileBlock(p: RepoProfile): string {
  const lines: string[] = ['--- Repo profile (learned by Pawn; verify before relying on unverified commands) ---']
  if (p.stack.length) lines.push(`Stack: ${p.stack.join(', ')}${p.packageManager ? ` · package manager: ${p.packageManager}` : ''}`)
  const cmds = COMMAND_KINDS.filter((k) => p.commands[k]).map((k) => {
    const c = p.commands[k]!
    const mark = c.verified ? ' ✓' : c.failures ? ` ✗×${c.failures}` : ''
    return `${k}: \`${c.command}\`${mark}${fmtDuration(c.durationMs)}`
  })
  if (cmds.length) lines.push(`Commands: ${cmds.join(' · ')}`)
  if (p.conventions.length) lines.push(`Conventions: ${p.conventions.slice(0, 8).join('; ')}`)
  if (p.notes.length) lines.push(`Gotchas & lessons:\n${p.notes.slice(-12).map((n) => `- ${n}`).join('\n')}`)
  const out = lines.join('\n')
  return out.length > 1800 ? `${out.slice(0, 1800)}…` : out
}

export function formatProfileFull(p: RepoProfile): string {
  const lines = [formatProfileBlock(p), '', 'Commands (detail):']
  for (const k of COMMAND_KINDS) {
    const c = p.commands[k]
    if (!c) continue
    lines.push(
      `- ${k}: ${c.command} [${c.source}${c.verified ? ', verified' : ''}${c.lastOkAt ? `, last ok ${new Date(c.lastOkAt).toISOString().slice(0, 16)}` : ''}${c.failures ? `, ${c.failures} recent failure(s)` : ''}]`
    )
  }
  if (p.notes.length) lines.push('', 'Notes (index: text):', ...p.notes.map((n, i) => `${i}: ${n}`))
  return lines.join('\n')
}

/** Test hook. */
export function _resetProfileCache(): void {
  cache.clear()
}
