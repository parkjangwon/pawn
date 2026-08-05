/**
 * Detect common project check scripts and run them (typecheck / test / lint).
 */

export type CheckKind = 'typecheck' | 'test' | 'lint' | 'build' | 'all'

interface DetectedCmd {
  kind: Exclude<CheckKind, 'all'>
  label: string
  command: string
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  const res = await window.api.fs.readFile(path)
  if (typeof res !== 'string') return null
  try {
    return JSON.parse(res) as Record<string, unknown>
  } catch {
    return null
  }
}

function hasScript(scripts: Record<string, unknown>, name: string): boolean {
  return typeof scripts[name] === 'string'
}

/** Prefer package manager from lockfiles. */
async function detectPm(root: string): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
  const checks: Array<['pnpm' | 'yarn' | 'bun' | 'npm', string]> = [
    ['pnpm', `${root}/pnpm-lock.yaml`],
    ['yarn', `${root}/yarn.lock`],
    ['bun', `${root}/bun.lockb`],
    ['npm', `${root}/package-lock.json`]
  ]
  for (const [pm, path] of checks) {
    if (await window.api.fs.exists(path)) return pm
  }
  return 'npm'
}

function runScript(pm: string, script: string): string {
  if (pm === 'pnpm') return `pnpm run ${script}`
  if (pm === 'yarn') return `yarn ${script}`
  if (pm === 'bun') return `bun run ${script}`
  return `npm run ${script}`
}

export async function detectCheckCommands(projectPath: string): Promise<DetectedCmd[]> {
  const root = projectPath.replace(/\/$/, '')
  const pkg = await readJson(`${root}/package.json`)
  const out: DetectedCmd[] = []
  if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
    const scripts = pkg.scripts as Record<string, unknown>
    const pm = await detectPm(root)
    const pairs: Array<[Exclude<CheckKind, 'all'>, string[]]> = [
      ['typecheck', ['typecheck', 'type-check', 'tsc']],
      ['test', ['test', 'test:unit', 'vitest']],
      ['lint', ['lint', 'eslint']],
      ['build', ['build']]
    ]
    for (const [kind, names] of pairs) {
      const hit = names.find((n) => hasScript(scripts, n))
      if (hit) {
        out.push({ kind, label: hit, command: runScript(pm, hit) })
      } else if (kind === 'typecheck') {
        // bare tsc if tsconfig exists
        if (await window.api.fs.exists(`${root}/tsconfig.json`)) {
          out.push({ kind, label: 'tsc --noEmit', command: 'npx tsc --noEmit' })
        }
      }
    }
    return out
  }

  // Python
  if (
    (await window.api.fs.exists(`${root}/pyproject.toml`)) ||
    (await window.api.fs.exists(`${root}/pytest.ini`)) ||
    (await window.api.fs.exists(`${root}/setup.py`))
  ) {
    out.push({ kind: 'test', label: 'pytest', command: 'python -m pytest -q' })
    out.push({ kind: 'lint', label: 'ruff', command: 'ruff check .' })
  }

  // Go
  if (await window.api.fs.exists(`${root}/go.mod`)) {
    out.push({ kind: 'test', label: 'go test', command: 'go test ./...' })
    out.push({ kind: 'build', label: 'go build', command: 'go build ./...' })
  }

  // Rust
  if (await window.api.fs.exists(`${root}/Cargo.toml`)) {
    out.push({ kind: 'test', label: 'cargo test', command: 'cargo test' })
    out.push({ kind: 'build', label: 'cargo build', command: 'cargo build' })
    out.push({ kind: 'lint', label: 'cargo clippy', command: 'cargo clippy -- -D warnings' })
  }

  return out
}

export async function runProjectChecks(
  projectPath: string,
  kind: CheckKind = 'all',
  timeoutSec = 120
): Promise<string> {
  const cmds = await detectCheckCommands(projectPath)
  if (!cmds.length) {
    return (
      'No standard check commands detected (package.json scripts / go.mod / Cargo.toml / pytest).\n' +
      'Run tests manually via shell_exec.'
    )
  }
  const selected =
    kind === 'all' ? cmds.filter((c) => c.kind !== 'build') : cmds.filter((c) => c.kind === kind)
  // if kind=all and only build exists, still run typecheck/test/lint empty message
  const toRun =
    kind === 'all'
      ? selected.length
        ? selected
        : cmds
      : selected

  if (!toRun.length) {
    const available = cmds.map((c) => `${c.kind}:${c.label}`).join(', ')
    return `No command for kind=${kind}. Available: ${available || '(none)'}`
  }

  const timeoutMs = Math.min(Math.max(timeoutSec, 30), 600) * 1000
  const blocks: string[] = [`# run_checks kind=${kind}`, `cwd: ${projectPath}`, '']

  for (const cmd of toRun) {
    blocks.push(`## ${cmd.kind} — \`${cmd.command}\``)
    const res = await window.api.shell.exec(cmd.command, projectPath, timeoutMs)
    const ok = res.exitCode === 0
    blocks.push(`exit: ${res.exitCode}${res.killed ? ' (killed/timeout)' : ''} ${ok ? 'OK' : 'FAIL'}`)
    const out = [res.stdout, res.stderr].filter(Boolean).join('\n').trim()
    const cap = 25_000
    blocks.push(out ? (out.length > cap ? out.slice(0, cap) + '\n…(truncated)' : out) : '(no output)')
    blocks.push('')
    // stop early on failure for sequential feedback
    if (!ok && kind === 'all') {
      blocks.push('Stopped remaining checks after first failure. Re-run with kind=test|typecheck|lint to focus.')
      break
    }
  }
  return blocks.join('\n')
}
