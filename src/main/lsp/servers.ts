/**
 * Language server catalog + discovery.
 *
 * Security: only *globally installed* servers are used — never binaries from
 * the project (node_modules/.bin, venv, …). A cloned repo must not be able to
 * run code just because the agent edited one of its files. For the same
 * reason tsserver is pinned to a global TypeScript install, and
 * rust-analyzer build scripts / proc macros are disabled.
 */

import { accessSync, constants, existsSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'

export type LspLanguage = 'typescript' | 'python' | 'go' | 'rust'

export interface ServerSpec {
  language: LspLanguage
  /** Candidate executables, first found wins. */
  commands: string[]
  args: string[]
  extensions: string[]
  rootMarkers: string[]
  installHint: string
  languageId: (ext: string) => string
  initializationOptions?: (command: string) => Record<string, unknown> | undefined | null
}

function tsLanguageId(ext: string): string {
  if (ext === '.tsx') return 'typescriptreact'
  if (ext === '.jsx') return 'javascriptreact'
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'javascript'
  return 'typescript'
}

/**
 * Global tsserver next to a global typescript-language-server install
 * (`<prefix>/lib/node_modules/{typescript-language-server,typescript}`), or
 * bundled inside the server package.
 */
export function findGlobalTsserver(serverCommand: string): string | null {
  let real: string
  try {
    real = realpathSync(serverCommand)
  } catch {
    return null
  }
  const candidates: string[] = []
  let dir = dirname(real)
  for (let i = 0; i < 6; i++) {
    if (dir.endsWith(`${sep}typescript-language-server`)) {
      candidates.push(join(dir, 'node_modules', 'typescript', 'lib', 'tsserver.js'))
      candidates.push(join(dirname(dir), 'typescript', 'lib', 'tsserver.js'))
      break
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  // Homebrew keeps each formula in its own libexec.
  candidates.push(join(dirname(real), '..', '..', 'typescript', 'lib', 'tsserver.js'))
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c)
  }
  return null
}

export const SERVER_SPECS: ServerSpec[] = [
  {
    language: 'typescript',
    commands: ['typescript-language-server'],
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    installHint: 'npm install -g typescript typescript-language-server',
    languageId: tsLanguageId,
    initializationOptions: (command) => {
      const tsserver = findGlobalTsserver(command)
      // Refuse to fall back to the workspace's own TypeScript (untrusted code).
      if (!tsserver) return null
      return { tsserver: { path: tsserver }, preferences: { includeCompletionsForModuleExports: false } }
    }
  },
  {
    language: 'python',
    commands: ['pyright-langserver', 'basedpyright-langserver'],
    args: ['--stdio'],
    extensions: ['.py', '.pyi'],
    rootMarkers: ['pyrightconfig.json', 'pyproject.toml', 'setup.cfg', 'setup.py', 'requirements.txt'],
    installHint: 'npm install -g pyright',
    languageId: () => 'python'
  },
  {
    language: 'go',
    commands: ['gopls'],
    args: [],
    extensions: ['.go'],
    rootMarkers: ['go.work', 'go.mod'],
    installHint: 'go install golang.org/x/tools/gopls@latest',
    languageId: () => 'go'
  },
  {
    language: 'rust',
    commands: ['rust-analyzer'],
    args: [],
    extensions: ['.rs'],
    rootMarkers: ['Cargo.toml'],
    installHint: 'rustup component add rust-analyzer',
    languageId: () => 'rust',
    initializationOptions: () => ({
      cargo: { buildScripts: { enable: false } },
      procMacro: { enable: false },
      checkOnSave: false
    })
  }
]

export function specForPath(path: string): ServerSpec | null {
  const ext = extname(path).toLowerCase()
  return SERVER_SPECS.find((s) => s.extensions.includes(ext)) ?? null
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Nearest directory (from the file up to `stopAt`) holding one of `markers`;
 * falls back to `stopAt` itself.
 */
export function findProjectRoot(file: string, markers: string[], stopAt: string): string {
  const stop = resolve(stopAt)
  let dir = dirname(resolve(file))
  if (!isInside(dir, stop)) return stop
  for (;;) {
    for (const m of markers) {
      if (existsSync(join(dir, m))) return dir
    }
    if (dir === stop) return stop
    const up = dirname(dir)
    if (up === dir || !isInside(up, stop)) return stop
    dir = up
  }
}

function extraBinDirs(): string[] {
  const home = homedir()
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    join(home, '.cargo', 'bin'),
    join(home, 'go', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, 'AppData', 'Roaming', 'npm')
  ]
}

/**
 * Resolve an executable from PATH + common global bin dirs, skipping any
 * directory inside `excludeRoot` (the project).
 */
export function resolveCommand(name: string, excludeRoot?: string, envPath = process.env.PATH || ''): string | null {
  const dirs = [...envPath.split(delimiter), ...extraBinDirs()].filter(Boolean)
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  const seen = new Set<string>()
  for (const d of dirs) {
    const dir = resolve(d)
    if (seen.has(dir)) continue
    seen.add(dir)
    if (excludeRoot && isInside(dir, resolve(excludeRoot))) continue
    for (const ext of exts) {
      const full = join(dir, name + ext)
      try {
        if (!statSync(full).isFile()) continue
        if (process.platform !== 'win32') accessSync(full, constants.X_OK)
        // A symlink into the project is still a project binary.
        if (excludeRoot && isInside(realpathSync(full), resolve(excludeRoot))) continue
        return full
      } catch {
        /* not here */
      }
    }
  }
  return null
}

export interface ResolvedServer {
  spec: ServerSpec
  command: string | null
  initializationOptions?: Record<string, unknown>
  /** Why the server can't run (missing binary / missing global tsserver). */
  unavailable?: string
}

export function resolveServer(spec: ServerSpec, projectRoot: string): ResolvedServer {
  for (const c of spec.commands) {
    const command = resolveCommand(c, projectRoot)
    if (!command) continue
    if (spec.initializationOptions) {
      const opts = spec.initializationOptions(command)
      if (opts === null) {
        return { spec, command, unavailable: `Global TypeScript not found — ${spec.installHint}` }
      }
      return { spec, command, initializationOptions: opts }
    }
    return { spec, command }
  }
  return { spec, command: null, unavailable: `${spec.commands[0]} not installed — ${spec.installHint}` }
}
