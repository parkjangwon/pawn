/**
 * Node implementation of the `window.api` surface the agent loop needs, so the
 * real agent (router, tools, compaction, …) runs without Electron: headless
 * CLI runs, CI, and the evaluation harness.
 *
 * Shell commands go through the same sandbox planner as the desktop app
 * (dangerous-command denylist, env allowlist, cwd jail, macOS network-off).
 * Persistence is in-memory; nothing is written under ~/.pawn.
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, rmdir, stat, unlink, writeFile, cp } from 'fs/promises'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import { planExecFile, planShellSpawn, type SandboxOptions } from '../main/shellSandbox'
import { contentSearch } from '../main/contentSearch'
import { isProtectedRemovePath, isSecretDotFile } from '../main/fsGuards'
import { CuaHelper, findHelper, helperCandidates } from '../main/computer/cuaHelper'
import { ComputerEngine } from '../main/computer/engine'
import { createAgentRuntime, validProjectRoot } from '../main/agentRuntime'
import { LspManager } from '../main/lsp/manager'
import { createKiroService, type KiroStreamEvent } from '../main/kiro/service'
import { readKiroCliLogin, readKiroIdeLogin, type KiroCredentials, type SqliteOpen } from '../main/kiro/auth'
import { createDecisionService } from '../main/decision/service'
import { emptyDecisionConfig, type DecisionConfig } from '../main/decision/types'
import { createRequire } from 'module'

export interface HeadlessConfig {
  settings?: Record<string, unknown>
  providers?: Array<Record<string, unknown>>
  models?: Array<Record<string, unknown>>
  /** Decision-model config (same shape as ~/.pawn/decision.json, plaintext keys). */
  decision?: Record<string, unknown>
}

export interface NodeApiOptions {
  config: HeadlessConfig
  /** Receives every agent notification / toast (for logs). */
  onLog?: (line: string) => void
  /**
   * Home directory the agent sees (user skills, ~/.claude/CLAUDE.md, …).
   * Evals point this at an empty dir so personal context can't skew results.
   */
  homeDir?: string
  /** Real desktop control through the native helper (macOS; off by default). */
  computer?: boolean
  /** Language servers like the desktop app (default true). */
  lsp?: boolean
}

const WALK_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.turbo', '.cache',
  '.parcel-cache', '.vite', '.svelte-kit', 'vendor', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.tox', '.venv', 'venv', '.idea', '.yarn', 'target'
])
const WALK_ALLOW_DOT_DIRS = new Set(['.github', '.claude', '.agent', '.agents', '.vscode', '.cursor', '.pawn', '.config'])
const WALK_MAX = 12_000
const WALK_MAX_DEPTH = 14
const MAX_READ_BYTES = 10 * 1024 * 1024
const MAX_BUFFER = 10 * 1024 * 1024

type ExecResult = { stdout: string; stderr: string; exitCode: number; killed?: boolean; sandboxNote?: string }

function clampTimeout(ms: unknown, fallback = 30_000): number {
  const v = Number(ms)
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(10 * 60_000, Math.max(1000, v))
}

function runSpawned(
  file: string,
  args: string[],
  cwd: string | undefined,
  timeoutMs: number,
  env: Record<string, string> | undefined,
  live: Set<ChildProcess>
): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(file, args, {
      cwd: cwd || undefined,
      env: env || (process.env as Record<string, string>),
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    live.add(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (r: ExecResult): void => {
      if (settled) return
      settled = true
      live.delete(child)
      clearTimeout(timer)
      resolvePromise(r)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      stdout = (stdout + c).slice(-MAX_BUFFER)
    })
    child.stderr?.on('data', (c: string) => {
      stderr = (stderr + c).slice(-MAX_BUFFER)
    })
    const timer = setTimeout(() => {
      killTree(child)
      finish({ stdout, stderr: `${stderr ? `${stderr}\n` : ''}Command timed out after ${timeoutMs}ms`, exitCode: 124, killed: true })
    }, timeoutMs)
    child.on('error', (err) => finish({ stdout, stderr: stderr || String(err), exitCode: 1 }))
    child.on('close', (code, signal) =>
      finish({ stdout, stderr, exitCode: typeof code === 'number' ? code : 1, killed: signal !== null || code === null })
    )
  })
}

function killTree(child: ChildProcess): void {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* gone */
    }
  }
}

function sandboxOpts(raw: unknown): SandboxOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: o.enabled !== false,
    network: o.network !== false,
    projectRoot: typeof o.projectRoot === 'string' ? o.projectRoot : undefined,
    jailCwd: o.jailCwd !== false
  }
}

async function walkTree(root: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
  const out: Array<{ name: string; path: string; isDirectory: boolean }> = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > WALK_MAX_DEPTH || out.length >= WALK_MAX) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= WALK_MAX) return
      const isDir = e.isDirectory()
      if (WALK_IGNORE.has(e.name)) continue
      if (e.name.startsWith('.')) {
        if (isDir ? !WALK_ALLOW_DOT_DIRS.has(e.name) : isSecretDotFile(e.name)) continue
      }
      const full = join(dir, e.name)
      out.push({ name: e.name, path: full, isDirectory: isDir })
      if (isDir) await walk(full, depth + 1)
    }
  }
  await walk(resolve(root), 0)
  return out
}

/** Build the api object. `dispose()` kills any shells still running. */
export function createNodeApi(opts: NodeApiOptions): { api: Record<string, any>; dispose: () => void } {
  const live = new Set<ChildProcess>()
  const jobs = new Map<string, { child: ChildProcess; command: string; stdout: string; stderr: string; exitCode: number | null; startedAt: number; killed?: boolean }>()
  let jobCounter = 0
  const transcripts = new Map<string, string>()
  const plans = new Map<string, string>()
  const modes = new Map<string, string>()
  const usage: Array<Record<string, unknown>> = []
  let config: HeadlessConfig = JSON.parse(JSON.stringify(opts.config || {}))
  const log = opts.onLog ?? (() => {})

  const fs = {
    readFile: async (p: string) => {
      try {
        const s = await stat(p)
        if (s.size > MAX_READ_BYTES) return { error: `File too large (${s.size} bytes)` }
        return await readFile(p, 'utf8')
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    readFiles: async (paths: string[]) =>
      Promise.all(
        (paths || []).slice(0, 500).map(async (p) => {
          const r = await fs.readFile(p)
          return typeof r === 'string' ? { path: p, content: r } : { path: p, error: r.error }
        })
      ),
    writeFile: async (p: string, content: string) => {
      if (!isAbsolute(p)) return { error: 'Invalid path (an absolute path is required)' }
      try {
        await mkdir(dirname(p), { recursive: true })
        await writeFile(p, content, 'utf8')
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    listDir: async (p: string) => {
      try {
        const entries = await readdir(p, { withFileTypes: true })
        return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), path: join(p, e.name) }))
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    stat: async (p: string) => {
      try {
        const s = await stat(p)
        return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    mkdir: async (p: string) => {
      if (!isAbsolute(p)) return { error: 'Invalid path (an absolute path is required)' }
      try {
        await mkdir(p, { recursive: true })
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    delete: async (p: string) => {
      if (!isAbsolute(p)) return { error: 'Invalid path (an absolute path is required)' }
      try {
        const s = await stat(p)
        if (s.isDirectory()) await rmdir(p)
        else await unlink(p)
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    exists: async (p: string) => existsSync(p),
    readImage: async (p: string) => {
      const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
      const m = mime[(/\.([A-Za-z0-9]+)$/.exec(p)?.[1] || '').toLowerCase()]
      if (!isAbsolute(p) || !m) return { error: 'Not an image file' }
      try {
        const buf = await readFile(p)
        return { dataUrl: `data:${m};base64,${buf.toString('base64')}`, size: buf.length, mtime: Date.now() }
      } catch {
        return { error: 'File not found' }
      }
    },
    homeDir: async () => opts.homeDir ?? homedir(),
    downloadsPath: async () => join(opts.homeDir ?? homedir(), 'Downloads'),
    walk: async (p: string) => walkTree(p),
    copyDir: async (src: string, dest: string) => {
      try {
        await cp(src, dest, { recursive: true })
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    removeDir: async (p: string) => {
      if (isProtectedRemovePath(p)) return { error: `Refusing to remove protected path: ${p}` }
      try {
        await rm(p, { recursive: true, force: true })
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    readSpreadsheet: async () => ({ error: 'Spreadsheet reading is not available in headless mode.' }),
    contentSearch: async (root: string, o: Parameters<typeof contentSearch>[1]) => contentSearch(root, o)
  }

  const shell = {
    exec: async (command: string, cwd?: string, timeoutMs?: number, sandbox?: unknown): Promise<ExecResult> => {
      const planned = planShellSpawn(command, cwd, sandboxOpts(sandbox))
      if (!planned.ok) return { stdout: '', stderr: planned.error, exitCode: 126, sandboxNote: 'blocked' }
      const r = await runSpawned(planned.plan.file, planned.plan.args, planned.plan.cwd, clampTimeout(timeoutMs), planned.plan.env, live)
      return { ...r, sandboxNote: planned.plan.sandboxNote }
    },
    execFile: async (file: string, args: string[], cwd?: string, timeoutMs?: number, sandbox?: unknown): Promise<ExecResult> => {
      const planned = planExecFile(file, args || [], cwd, sandboxOpts(sandbox))
      if (!planned.ok) return { stdout: '', stderr: planned.error, exitCode: 126 }
      return runSpawned(planned.plan.file, planned.plan.args, planned.plan.cwd, clampTimeout(timeoutMs), planned.plan.env, live)
    },
    start: async (command: string, cwd?: string, sandbox?: unknown) => {
      const planned = planShellSpawn(command, cwd, sandboxOpts(sandbox))
      if (!planned.ok) return { error: planned.error }
      const child = spawn(planned.plan.file, planned.plan.args, {
        cwd: planned.plan.cwd || undefined,
        env: planned.plan.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const jobId = `job-${++jobCounter}`
      const job = { child, command, stdout: '', stderr: '', exitCode: null as number | null, startedAt: Date.now(), killed: false }
      jobs.set(jobId, job)
      live.add(child)
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (c: string) => (job.stdout = (job.stdout + c).slice(-MAX_BUFFER)))
      child.stderr?.on('data', (c: string) => (job.stderr = (job.stderr + c).slice(-MAX_BUFFER)))
      child.on('close', (code) => {
        job.exitCode = typeof code === 'number' ? code : 1
        live.delete(child)
      })
      return { jobId, pid: child.pid, sandboxNote: planned.plan.sandboxNote }
    },
    poll: async (jobId: string) => {
      const j = jobs.get(jobId)
      if (!j) return { error: `Unknown job ${jobId}` }
      return {
        jobId,
        command: j.command,
        status: j.exitCode === null ? 'running' : 'exited',
        stdout: j.stdout,
        stderr: j.stderr,
        exitCode: j.exitCode,
        killed: j.killed,
        elapsedMs: Date.now() - j.startedAt
      }
    },
    kill: async (jobId: string) => {
      const j = jobs.get(jobId)
      if (!j) return { error: `Unknown job ${jobId}` }
      j.killed = true
      killTree(j.child)
      return { ok: true, jobId }
    },
    killAll: async () => {
      const n = live.size
      for (const c of Array.from(live)) killTree(c)
      return { ok: true, killed: n }
    },
    killSession: async (sessionId?: string) => {
      if (sessionId) rt.bash.kill(sessionId)
      return shell.killAll()
    }
  }

  const db = {
    loadAll: async () => ({ projects: [] }),
    getMessages: async () => [],
    searchSessions: async () => [],
    getTranscript: async (sessionId: string) => transcripts.get(sessionId) ?? null,
    saveTranscript: async (sessionId: string, json: string) => {
      transcripts.set(sessionId, json)
      return { ok: true }
    },
    clearTranscript: async (sessionId: string) => {
      transcripts.delete(sessionId)
      return { ok: true }
    },
    getSessionPlan: async (sessionId: string) => plans.get(sessionId) ?? null,
    saveSessionPlan: async (sessionId: string, json: string) => {
      plans.set(sessionId, json)
      return { ok: true }
    },
    getSessionAgentMode: async (sessionId: string) => modes.get(sessionId) ?? null,
    saveSessionAgentMode: async (sessionId: string, mode: string) => {
      modes.set(sessionId, mode)
      return { ok: true }
    },
    addUsage: async (row: Record<string, unknown>) => {
      usage.push(row)
      return { ok: true }
    },
    getUsageBySession: async (sessionId: string) => usage.filter((u) => u.sessionId === sessionId),
    getUsageSummary: async () => ({ totalCost: 0, calls: 0 }),
    listRunningTurnCheckpoints: async () => [],
    getTurnCheckpoint: async () => null,
    listChangeLedgerTurns: async () => []
  }
  const ok = async () => ({ ok: true })
  for (const m of [
    'addProject', 'removeProject', 'updateProjectName', 'updateProjectPaths', 'addSession', 'removeSession',
    'updateSessionTitle', 'updateSessionPath', 'addMessage', 'updateMessageContent', 'updateMessageMeta',
    'deleteMessage', 'clearMessages', 'saveTurnCheckpoint', 'clearTurnCheckpoint', 'saveChangeLedgerTurn',
    'deleteChangeLedgerTurn', 'deleteChangeLedgerForSession'
  ]) {
    ;(db as Record<string, unknown>)[m] = ok
  }

  // Computer use: the same helper + engine as the desktop app.
  let cua: CuaHelper | null = null
  let computer: Record<string, unknown> | undefined
  if (opts.computer && process.platform === 'darwin') {
    const path = findHelper(helperCandidates({ cwd: process.cwd() }))
    if (path) {
      cua = new CuaHelper({ path })
      const engine = new ComputerEngine(cua)
      computer = {
        exec: async (action: string, args: Record<string, unknown> = {}, policy?: Record<string, unknown>) => {
          engine.setPolicy(policy as never)
          try {
            return await engine.execute(action, args)
          } catch (err) {
            return { ok: false, text: err instanceof Error ? err.message : String(err) }
          }
        },
        status: async () => {
          const p = await cua!.call<{ accessibility: boolean; screenRecording: boolean }>('permissions')
          return { ok: p.accessibility && p.screenRecording, backend: 'native', platform: 'darwin', ...p, notes: [], errors: [] }
        },
        releaseAll: async () => {
          await cua!.call('release_all').catch(() => {})
          return { ok: true }
        },
        overlay: async (enabled: boolean) => {
          await cua!.call('overlay', { enabled }).catch(() => {})
          return { ok: true }
        }
      }
    }
  }

  // Same runtime services as the desktop main process; outputs and profiles
  // stay in memory (nothing is written under ~/.pawn).
  const rt = createAgentRuntime({ pawnDir: null })

  // Language servers (same manager as the desktop main process).
  const lspManager = opts.lsp === false ? null : new LspManager()
  const lspWrap = async <T extends object>(fn: () => Promise<T & { error?: string }>): Promise<Record<string, unknown>> => {
    try {
      const r = await fn()
      return { ...r, ok: !r.error }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  const lsp = lspManager
    ? {
        setEnabled: async (v: boolean) => (lspManager.setEnabled(v), { ok: true }),
        status: async (root: string) => lspManager.status(validProjectRoot(root) ?? undefined),
        diagnostics: async (root: string, paths: string[], o?: { waitMs?: number; content?: Record<string, string> }) => {
          const r = validProjectRoot(root)
          if (!r) return { ok: false, error: 'Invalid project root', files: [] }
          const res = await lspManager.diagnostics(r, paths || [], o || {})
          return { ok: res.files.length > 0 || res.errors.length === 0, ...(res.errors.length ? { error: res.errors.join('; ') } : {}), files: res.files, unsupported: res.unsupported }
        },
        definition: (root: string, path: string, line: number, col: number) =>
          lspWrap(() => lspManager.locations('textDocument/definition', validProjectRoot(root) || '/nonexistent', path, line, col)),
        references: (root: string, path: string, line: number, col: number) =>
          lspWrap(() => lspManager.locations('textDocument/references', validProjectRoot(root) || '/nonexistent', path, line, col)),
        hover: (root: string, path: string, line: number, col: number) => lspWrap(() => lspManager.hover(validProjectRoot(root) || '/nonexistent', path, line, col)),
        rename: (root: string, path: string, line: number, col: number, name: string) =>
          lspWrap(() => lspManager.rename(validProjectRoot(root) || '/nonexistent', path, line, col, name)),
        symbols: (root: string, path: string, query?: string) =>
          lspWrap(() => (query ? lspManager.workspaceSymbols(validProjectRoot(root) || '/nonexistent', query, path) : lspManager.documentSymbols(validProjectRoot(root) || '/nonexistent', path))),
        callHierarchy: (root: string, path: string, line: number, col: number, dir: 'incoming' | 'outgoing') =>
          lspWrap(() => lspManager.callHierarchy(validProjectRoot(root) || '/nonexistent', path, line, col, dir)),
        codeActions: (root: string, path: string, range: { startLine: number; startColumn?: number; endLine?: number; endColumn?: number }, only?: string[]) =>
          lspWrap(() =>
            lspManager.codeActions(
              validProjectRoot(root) || '/nonexistent',
              path,
              { startLine: range.startLine, startColumn: range.startColumn ?? 1, endLine: range.endLine ?? range.startLine, endColumn: range.endColumn ?? 1 },
              only
            )
          ),
        applyCodeAction: (root: string, path: string, index: number) => lspWrap(() => lspManager.applyCodeAction(validProjectRoot(root) || '/nonexistent', path, index))
      }
    : undefined

  // Kiro: KIRO_API_KEY from the environment, else the Kiro CLI / IDE login
  // (read-only). Credentials stay in memory.
  const kiroListeners = new Set<(d: { requestId: string; event: KiroStreamEvent }) => void>()
  let sqliteOpen: SqliteOpen | null = null
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3') as new (p: string, o: Record<string, unknown>) => ReturnType<SqliteOpen>
    sqliteOpen = (p) => new Database(p, { readonly: true, fileMustExist: true, timeout: 2000 })
  } catch {
    sqliteOpen = null
  }
  let kiroMem: KiroCredentials | null | undefined
  const kiro = createKiroService({
    store: {
      load: async () => {
        if (kiroMem !== undefined) return kiroMem
        const key = process.env.KIRO_API_KEY?.trim()
        kiroMem = key
          ? { mode: 'api-key', apiKey: key, region: process.env.KIRO_REGION || 'us-east-1' }
          : readKiroCliLogin(sqliteOpen) ?? readKiroIdeLogin()
        return kiroMem
      },
      save: async (c) => {
        kiroMem = c
      }
    },
    // The real home: `homeDir` hides personal context (skills, CLAUDE.md),
    // not credentials.
    sqlite: sqliteOpen,
    version: 'headless',
    emit: (requestId, event) => {
      for (const l of Array.from(kiroListeners)) l({ requestId, event })
    }
  })

  // Decision models: same service as the desktop app; config stays in memory.
  let decisionCfg: DecisionConfig = opts.config?.decision
    ? (JSON.parse(JSON.stringify(opts.config.decision)) as DecisionConfig)
    : emptyDecisionConfig()
  const decision = createDecisionService({
    store: {
      load: () => decisionCfg,
      save: (c) => {
        decisionCfg = JSON.parse(JSON.stringify(c)) as DecisionConfig
      }
    }
  })

  const api: Record<string, any> = {
    platform: 'headless',
    ...(lsp ? { lsp } : {}),
    decision: {
      status: async () => decision.status(),
      saveProvider: async (input: unknown) => decision.saveProvider(input),
      removeProvider: async (id: string) => decision.removeProvider(id),
      setEnabled: async (id: string, enabled: boolean) => decision.setEnabled(id, enabled),
      setFeatures: async (partial: unknown) => decision.setFeatures(partial),
      models: (id: string) => decision.listModels(id),
      test: (id: string) => decision.test(id),
      decide: (input: unknown, o?: { purpose?: 'tool' | 'shell_risk' | 'routing'; timeoutMs?: number; maxRetries?: number }) =>
        decision.decide(input, o || {})
    },
    kiro: {
      status: () => kiro.status(),
      startLogin: (o: unknown) => kiro.startLogin(o),
      cancelLogin: async () => kiro.cancelLogin(),
      signOut: () => kiro.signOut(),
      setApiKey: (k: string, r?: string) => kiro.setApiKey(k, r),
      importLogin: (src?: string) => kiro.importLogin(src),
      models: () => kiro.models(),
      usage: () => kiro.usage(),
      chatStart: async (id: string, body: unknown) => kiro.chatStart(id, body),
      chatAbort: async (id: string) => kiro.chatAbort(id),
      onEvent: (cb: (d: { requestId: string; event: KiroStreamEvent }) => void) => {
        kiroListeners.add(cb)
        return () => kiroListeners.delete(cb)
      },
      onLoginDone: () => () => {}
    },
    bash: {
      run: (key: string, command: string, o: unknown) => rt.bash.run(key, command, o),
      restart: (key: string, cwd: string, sandbox?: unknown) => rt.bash.restart(key, cwd, sandbox),
      kill: async (key: string) => rt.bash.kill(key)
    },
    debug: {
      start: (o: unknown) => rt.debug.start(o),
      setBreakpoints: (key: string, path: string, lines: unknown) => rt.debug.setBreakpoints(key, path, lines),
      control: (key: string, action: string, timeoutMs?: number) => rt.debug.control(key, action, timeoutMs),
      evaluate: (key: string, expression: string, frameId?: number) => rt.debug.evaluate(key, expression, frameId),
      stop: (key: string) => rt.debug.stop(key),
      list: async () => rt.debug.list()
    },
    codeIndex: {
      search: (root: string, queries: string[], o?: unknown) => rt.codeIndex.search(root, queries, o),
      update: (root: string) => rt.codeIndex.update(root)
    },
    tests: { affected: (root: string, files: string[], o?: unknown) => rt.tests.affected(root, files, o) },
    net: { probePort: (port: number, host?: string) => rt.net.probePort(port, host) },
    outputs: {
      save: (sessionId: string, content: string) => rt.outputs.save(sessionId, content),
      read: (id: string, o?: unknown) => rt.outputs.read(id, o)
    },
    // Mirrors the preload channel of the same name (chat tool-row paging).
    // Headless has no tool rows, but the shape stays in lockstep per the
    // nodeApi convention so a future caller cannot silently diverge.
    toolOutput: {
      get: async (id: string, offset?: number, limit?: number) => rt.outputs.readRaw(id, { offset, limit })
    },
    profile: {
      get: (root: string) => rt.profile.get(root),
      save: (root: string, json: string) => rt.profile.save(root, json)
    },
    ...(computer ? { computer } : {}),
    appVersion: async () => 'headless',
    fs,
    shell,
    db,
    config: {
      load: async () => JSON.parse(JSON.stringify(config)),
      save: async (patch: HeadlessConfig) => {
        config = {
          ...config,
          ...patch,
          settings: { ...(config.settings || {}), ...(patch?.settings || {}) }
        }
        return { ok: true }
      }
    },
    connections: { list: async () => [] },
    notification: {
      send: async (title: string, body: string) => {
        log(`[notify] ${title}: ${body}`)
        return { ok: true }
      }
    },
    setStreaming: () => {},
    setSessionStreaming: () => {}
  }

  return {
    api,
    dispose: () => {
      for (const c of Array.from(live)) killTree(c)
      live.clear()
      cua?.dispose()
      void rt.dispose()
      void lspManager?.disposeAll().catch(() => {})
      kiro.dispose()
    }
  }
}
