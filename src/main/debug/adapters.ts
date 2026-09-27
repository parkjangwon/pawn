import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, basename } from 'node:path'
import type { DebugLanguage, DebugStartOptions } from './types'

/**
 * Adapter resolution and launch-argument construction for each supported
 * debugger backend. Node is handled separately by cdpBackend; this module
 * covers the DAP-based backends (python/go/lldb) plus shared helpers.
 */

export interface ResolvedDapAdapter {
  /** How to reach the adapter: spawn a process (stdio) or connect to TCP. */
  transport: 'stdio' | 'tcp'
  command?: string
  args?: string[]
  /** For tcp adapters that must be spawned first, the spawn command. */
  spawnCommand?: string
  spawnArgs?: string[]
  /** Regex to parse the listening port from the spawned process output. */
  portRegex?: RegExp
  adapterID: string
  env: Record<string, string>
}

/** Build a PATH that includes common toolchain locations. */
export function augmentedPath(baseEnv: Record<string, string | undefined> = process.env): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), 'go', 'bin')]
  const current = baseEnv.PATH ?? ''
  const parts = current.split(':').filter(Boolean)
  for (const p of extra) {
    if (!parts.includes(p)) parts.push(p)
  }
  return parts.join(':')
}

/** Merge process env + user env + an augmented PATH into a string map. */
export function buildEnv(userEnv?: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') merged[k] = v
  }
  if (userEnv) {
    for (const [k, v] of Object.entries(userEnv)) merged[k] = v
  }
  merged.PATH = augmentedPath({ ...merged, PATH: merged.PATH })
  return merged
}

/** Detect a program's debug language from its file extension / layout. */
export function detectLanguage(program: string, cwd?: string): DebugLanguage {
  const ext = extname(program).toLowerCase()
  if (ext === '.py') return 'python'
  if (ext === '.go') return 'go'
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.ts') return 'node'
  // A directory (or cwd) containing go.mod → go.
  const goModDir = cwd ?? program
  if (existsSync(join(goModDir, 'go.mod'))) return 'go'
  if (basename(program) === 'go.mod') return 'go'
  // Executable / unknown → native (lldb).
  return 'lldb'
}

/** Resolve the requested language, defaulting to auto-detection. */
export function resolveLanguage(opts: DebugStartOptions): DebugLanguage {
  if (opts.language && opts.language !== 'auto') return opts.language
  return detectLanguage(opts.program, opts.cwd)
}

function which(cmd: string, env: Record<string, string>): string | null {
  const res = spawnSync('sh', ['-c', `command -v ${cmd}`], {
    env,
    encoding: 'utf8'
  })
  const out = (res.stdout || '').trim()
  return out ? out.split('\n')[0] : null
}

// ---- Launch argument builders --------------------------------------------

export function buildPythonLaunchArgs(opts: DebugStartOptions): Record<string, unknown> {
  return {
    type: 'python',
    request: 'launch',
    program: opts.program,
    args: opts.args ?? [],
    cwd: opts.cwd,
    env: opts.env ?? {},
    stopOnEntry: Boolean(opts.stopOnEntry),
    justMyCode: true,
    console: 'internalConsole'
  }
}

export function buildGoLaunchArgs(opts: DebugStartOptions): Record<string, unknown> {
  return {
    request: 'launch',
    mode: 'debug',
    program: opts.program,
    args: opts.args ?? [],
    cwd: opts.cwd,
    env: opts.env ?? {},
    stopOnEntry: Boolean(opts.stopOnEntry)
  }
}

export function buildLldbLaunchArgs(opts: DebugStartOptions): Record<string, unknown> {
  // lldb-dap expects env as an array of "K=V" strings.
  const envArray: string[] = []
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) envArray.push(`${k}=${v}`)
  }
  return {
    request: 'launch',
    program: opts.program,
    args: opts.args ?? [],
    cwd: opts.cwd,
    env: envArray,
    stopOnEntry: Boolean(opts.stopOnEntry)
  }
}

export function buildLaunchArgs(
  language: DebugLanguage,
  opts: DebugStartOptions
): Record<string, unknown> {
  switch (language) {
    case 'python':
      return buildPythonLaunchArgs(opts)
    case 'go':
      return buildGoLaunchArgs(opts)
    case 'lldb':
      return buildLldbLaunchArgs(opts)
    default:
      throw new Error(`buildLaunchArgs: unsupported DAP language "${language}"`)
  }
}

// ---- Adapter resolution ----------------------------------------------------

export const GO_PORT_REGEX = /DAP server listening at:\s*127\.0\.0\.1:(\d+)/i

export function resolvePythonAdapter(opts: DebugStartOptions): ResolvedDapAdapter {
  const env = buildEnv(opts.env)
  const python = opts.runtimeExecutable || 'python3'
  const check = spawnSync(python, ['-c', 'import debugpy'], { env, encoding: 'utf8' })
  if (check.status !== 0) {
    throw new Error('debugpy is not installed: run `python3 -m pip install debugpy`')
  }
  return {
    transport: 'stdio',
    command: python,
    args: ['-m', 'debugpy.adapter'],
    adapterID: 'debugpy',
    env
  }
}

export function resolveGoAdapter(opts: DebugStartOptions): ResolvedDapAdapter {
  const env = buildEnv(opts.env)
  const dlv = opts.runtimeExecutable || which('dlv', env)
  if (!dlv) {
    throw new Error('delve (dlv) is not installed: run `go install github.com/go-delve/delve/cmd/dlv@latest`')
  }
  return {
    transport: 'tcp',
    spawnCommand: dlv,
    spawnArgs: ['dap', '--listen=127.0.0.1:0'],
    portRegex: GO_PORT_REGEX,
    adapterID: 'go',
    env
  }
}

export function resolveLldbAdapter(opts: DebugStartOptions): ResolvedDapAdapter {
  const env = buildEnv(opts.env)
  let command = opts.runtimeExecutable || which('lldb-dap', env)
  if (!command && process.platform === 'darwin') {
    const res = spawnSync('xcrun', ['-f', 'lldb-dap'], { env, encoding: 'utf8' })
    const out = (res.stdout || '').trim()
    if (res.status === 0 && out) command = out
  }
  if (!command) command = which('lldb-vscode', env)
  if (!command) {
    throw new Error(
      'lldb-dap could not be resolved. Install LLVM (brew install llvm) or Xcode command line tools.'
    )
  }
  return {
    transport: 'stdio',
    command,
    args: [],
    adapterID: 'lldb',
    env
  }
}

export function resolveDapAdapter(
  language: DebugLanguage,
  opts: DebugStartOptions
): ResolvedDapAdapter {
  switch (language) {
    case 'python':
      return resolvePythonAdapter(opts)
    case 'go':
      return resolveGoAdapter(opts)
    case 'lldb':
      return resolveLldbAdapter(opts)
    default:
      throw new Error(`resolveDapAdapter: "${language}" is not a DAP language`)
  }
}

/** Resolve the `node` binary for the CDP backend (never process.execPath). */
export function resolveNodeBinary(opts: DebugStartOptions): string {
  if (opts.runtimeExecutable) return opts.runtimeExecutable
  const env = buildEnv(opts.env)
  const found = which('node', env)
  if (found) return found
  return 'node'
}
