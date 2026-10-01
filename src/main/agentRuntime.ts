/**
 * Agent runtime services shared by the Electron main process (IPC) and the
 * headless runner: persistent bash sessions, the debugger, the local code
 * index + affected-test selection, port probes, offloaded tool outputs and
 * repo profiles. Pure Node — no electron imports.
 *
 * Every method returns plain JSON (never throws) so both transports can pass
 * results straight to the renderer.
 */

import { createHash, randomBytes } from 'crypto'
import { statSync } from 'fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { createConnection } from 'net'
import { tmpdir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { formatBashResult, getBashSessionManager } from './bashSession'
import { isProtectedRemovePath } from './fsGuards'
import { shellPolicyFloor } from './config'
import { withSandboxPolicyFloor, type SandboxOptions } from './shellSandbox'
import { formatDebugState, getDebugManager } from './debug/manager'
import type { DebugLanguage, DebugState } from './debug/types'
import { CodeIndex, formatSearchHits, type SearchHit } from './codeIndex/index'
import { findAffectedTests, formatAffectedTests } from './codeIndex/affectedTests'

export interface AgentRuntimeOptions {
  /** ~/.pawn (desktop). Null = keep outputs/profiles in memory (headless). */
  pawnDir: string | null
  /** Where the code index is cached (defaults under pawnDir, else tmp). */
  indexDir?: string
}

type Ok<T> = { ok: true } & T
type Fail = { ok: false; error: string }

function fail(err: unknown): Fail {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/** A real project directory — never /, the home directory, or a system folder. */
export function validProjectRoot(root: unknown): string | null {
  if (typeof root !== 'string' || !root.trim() || !isAbsolute(root)) return null
  const abs = resolve(root)
  if (isProtectedRemovePath(abs)) return null
  try {
    return statSync(abs).isDirectory() ? abs : null
  } catch {
    return null
  }
}

function validDir(dir: unknown): string | null {
  if (typeof dir !== 'string' || !dir.trim() || !isAbsolute(dir)) return null
  try {
    return statSync(dir).isDirectory() ? resolve(dir) : null
  } catch {
    return null
  }
}

function sandboxFrom(raw: unknown): SandboxOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // Same floor as the shell IPC: the stored prefs win over what the caller asks.
  return withSandboxPolicyFloor(
    {
      enabled: o.enabled !== false,
      network: o.network !== false,
      projectRoot: typeof o.projectRoot === 'string' ? o.projectRoot : undefined,
      jailCwd: o.jailCwd !== false
    },
    shellPolicyFloor()
  )
}

function hashKey(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16)
}

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,120}$/

// --- Offloaded tool outputs ------------------------------------------------

export interface OutputReadOptions {
  /** 1-based first line (default 1). */
  offset?: number
  /** Lines to return (default 200, max 2000). */
  limit?: number
  /** Regex (or plain text) filter; returns matching lines with numbers. */
  grep?: string
  /** Lines of context around grep hits (0-5). */
  context?: number
  /** Return the last N lines instead. */
  tail?: number
}

export function readOutputSlice(full: string, opts: OutputReadOptions = {}): string {
  const lines = full.split('\n')
  const total = lines.length
  const num = (i: number): string => `${String(i + 1).padStart(6)}  ${lines[i].slice(0, 2000)}`
  if (opts.grep) {
    let re: RegExp
    try {
      re = new RegExp(opts.grep, 'i')
    } catch {
      re = new RegExp(opts.grep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
    const ctx = Math.max(0, Math.min(5, Math.floor(Number(opts.context) || 0)))
    const keep = new Set<number>()
    let hits = 0
    for (let i = 0; i < total && hits < 300; i++) {
      if (!re.test(lines[i])) continue
      hits++
      for (let j = Math.max(0, i - ctx); j <= Math.min(total - 1, i + ctx); j++) keep.add(j)
    }
    if (hits === 0) return `No lines match ${JSON.stringify(opts.grep)} (${total} lines total).`
    const idx = Array.from(keep).sort((a, b) => a - b)
    const out: string[] = []
    let prev = -2
    for (const i of idx) {
      if (i !== prev + 1 && out.length) out.push('    --')
      out.push(num(i))
      prev = i
    }
    return `${hits} matching line${hits === 1 ? '' : 's'} of ${total}:\n${out.join('\n')}`
  }
  const limit = Math.max(1, Math.min(2000, Math.floor(Number(opts.limit) || 200)))
  let start: number
  if (opts.tail && opts.tail > 0) start = Math.max(0, total - Math.min(2000, Math.floor(opts.tail)))
  else start = Math.max(0, Math.floor(Number(opts.offset) || 1) - 1)
  const end = Math.min(total, start + limit)
  if (start >= total) return `Offset ${start + 1} is past the end (${total} lines).`
  const body: string[] = []
  for (let i = start; i < end; i++) body.push(num(i))
  const more = end < total ? `\n…(${total - end} more lines; continue with offset=${end + 1})` : ''
  return `lines ${start + 1}-${end} of ${total}:\n${body.join('\n')}${more}`
}

// --- Port probe --------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

export function probePort(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
  return new Promise((resolvePromise) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !LOCAL_HOSTS.has(host)) {
      resolvePromise(false)
      return
    }
    const socket = createConnection({ port, host: host === '0.0.0.0' ? '127.0.0.1' : host })
    let done = false
    const finish = (v: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolvePromise(v)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

// --- Runtime -----------------------------------------------------------------

export function createAgentRuntime(opts: AgentRuntimeOptions) {
  const memOutputs = new Map<string, string>()
  const memProfiles = new Map<string, string>()
  const indexDir = opts.indexDir || (opts.pawnDir ? join(opts.pawnDir, 'index') : join(tmpdir(), 'pawn-code-index'))
  const outputsDir = opts.pawnDir ? join(opts.pawnDir, 'outputs') : null
  const profilesDir = opts.pawnDir ? join(opts.pawnDir, 'profiles') : null
  let outputsPruned = false

  const indexes = new Map<string, { index: CodeIndex; loaded: boolean; lastUpdate: number; updating: Promise<unknown> | null }>()

  async function ensureIndex(root: string, maxAgeMs: number): Promise<CodeIndex> {
    let entry = indexes.get(root)
    if (!entry) {
      entry = { index: new CodeIndex({ root, cacheDir: indexDir }), loaded: false, lastUpdate: 0, updating: null }
      indexes.set(root, entry)
    }
    const e = entry
    if (!e.loaded) {
      e.loaded = true
      await e.index.load()
    }
    if (Date.now() - e.lastUpdate > maxAgeMs) {
      if (!e.updating) {
        e.updating = e.index
          .update()
          .then(() => {
            e.lastUpdate = Date.now()
          })
          .finally(() => {
            e.updating = null
          })
      }
      await e.updating
    }
    return e.index
  }

  async function pruneOutputs(): Promise<void> {
    if (outputsPruned || !outputsDir) return
    outputsPruned = true
    try {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      for (const name of await readdir(outputsDir)) {
        const p = join(outputsDir, name)
        const s = await stat(p).catch(() => null)
        if (s && s.mtimeMs < cutoff) await rm(p, { recursive: true, force: true }).catch(() => {})
      }
    } catch {
      /* no outputs yet */
    }
  }

  const debugText = (state: DebugState): Ok<{ state: DebugState; text: string }> => ({
    ok: true,
    state,
    text: formatDebugState(state)
  })

  return {
    bash: {
      async run(key: unknown, command: unknown, o: unknown): Promise<Ok<{ text: string; exitCode: number | null; cwd: string; timedOut: boolean; restarted: boolean }> | Fail> {
        try {
          if (typeof key !== 'string' || !SAFE_ID.test(key)) return { ok: false, error: 'Invalid bash session key' }
          if (typeof command !== 'string' || !command.trim()) return { ok: false, error: 'command is required' }
          const oo = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
          const cwd = validDir(oo.cwd)
          if (!cwd) return { ok: false, error: 'A valid working directory is required' }
          const r = await getBashSessionManager().run(key, command, {
            cwd,
            timeoutMs: typeof oo.timeoutMs === 'number' ? oo.timeoutMs : undefined,
            sandbox: sandboxFrom(oo.sandbox)
          })
          return { ok: true, text: formatBashResult(r), exitCode: r.exitCode, cwd: r.cwd, timedOut: r.timedOut, restarted: r.restarted }
        } catch (err) {
          return fail(err)
        }
      },
      async restart(key: unknown, cwd: unknown, sandbox: unknown): Promise<Ok<{ text: string }> | Fail> {
        try {
          if (typeof key !== 'string' || !SAFE_ID.test(key)) return { ok: false, error: 'Invalid bash session key' }
          const dir = validDir(cwd)
          if (!dir) return { ok: false, error: 'A valid working directory is required' }
          await getBashSessionManager().restart(key, dir, sandboxFrom(sandbox))
          return { ok: true, text: 'Bash session restarted.' }
        } catch (err) {
          return fail(err)
        }
      },
      kill(key: unknown): { ok: boolean } {
        if (typeof key !== 'string') return { ok: false }
        return { ok: getBashSessionManager().kill(key) }
      },
      killAll(): { ok: true; killed: number } {
        return { ok: true, killed: getBashSessionManager().killAll() }
      }
    },

    debug: {
      async start(raw: unknown): Promise<Ok<{ state: DebugState; text: string }> | Fail> {
        try {
          const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
          const cwd = validDir(o.cwd)
          if (!cwd) return { ok: false, error: 'A valid working directory (cwd) is required' }
          if (typeof o.sessionKey !== 'string' || !SAFE_ID.test(o.sessionKey)) return { ok: false, error: 'Invalid session key' }
          if (typeof o.program !== 'string' || !o.program.trim()) return { ok: false, error: 'program is required' }
          const strList = (v: unknown): string[] | undefined =>
            Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 64) : undefined
          const bps = Array.isArray(o.breakpoints)
            ? o.breakpoints
                .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
                .map((b) => ({ path: String(b.path || ''), line: Math.floor(Number(b.line)), ...(typeof b.condition === 'string' && b.condition ? { condition: b.condition } : {}) }))
                .filter((b) => b.path && b.line > 0)
                .slice(0, 100)
            : undefined
          const env = o.env && typeof o.env === 'object'
            ? Object.fromEntries(Object.entries(o.env as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
            : undefined
          const state = await getDebugManager().start({
            sessionKey: o.sessionKey,
            language: typeof o.language === 'string' ? (o.language as DebugLanguage | 'auto') : 'auto',
            program: o.program,
            args: strList(o.args),
            cwd,
            env,
            stopOnEntry: o.stopOnEntry === true,
            breakpoints: bps,
            runtimeExecutable: typeof o.runtimeExecutable === 'string' ? o.runtimeExecutable : undefined,
            runtimeArgs: strList(o.runtimeArgs),
            timeoutMs: typeof o.timeoutMs === 'number' ? o.timeoutMs : undefined
          })
          return debugText(state)
        } catch (err) {
          return fail(err)
        }
      },
      async setBreakpoints(key: unknown, path: unknown, lines: unknown): Promise<Ok<{ state: DebugState; text: string }> | Fail> {
        try {
          if (typeof key !== 'string' || typeof path !== 'string') return { ok: false, error: 'Invalid arguments' }
          const list = Array.isArray(lines)
            ? lines
                .map((l) => (typeof l === 'number' ? { line: l } : (l as { line?: unknown; condition?: unknown })))
                .map((l) => ({ line: Math.floor(Number(l.line)), ...(typeof l.condition === 'string' && l.condition ? { condition: l.condition } : {}) }))
                .filter((l) => l.line > 0)
                .slice(0, 100)
            : []
          return debugText(await getDebugManager().setBreakpoints(key, path, list))
        } catch (err) {
          return fail(err)
        }
      },
      async control(key: unknown, action: unknown, timeoutMs?: unknown): Promise<Ok<{ state: DebugState; text: string }> | Fail> {
        try {
          if (typeof key !== 'string') return { ok: false, error: 'Invalid session key' }
          const m = getDebugManager()
          const t = typeof timeoutMs === 'number' && timeoutMs > 0 ? Math.min(120_000, timeoutMs) : undefined
          switch (action) {
            case 'continue':
              return debugText(await m.continue(key, t))
            case 'over':
            case 'into':
            case 'out':
              return debugText(await m.step(key, action, t))
            case 'pause':
              return debugText(await m.pause(key))
            case 'state':
              return debugText(m.state(key))
            default:
              return { ok: false, error: `Unknown debug action: ${String(action)}` }
          }
        } catch (err) {
          return fail(err)
        }
      },
      async evaluate(key: unknown, expression: unknown, frameId?: unknown): Promise<Ok<{ result: string; type?: string }> | Fail> {
        try {
          if (typeof key !== 'string' || typeof expression !== 'string' || !expression.trim()) return { ok: false, error: 'expression is required' }
          const r = await getDebugManager().evaluate(key, expression, typeof frameId === 'number' ? frameId : undefined)
          if (r.error) return { ok: false, error: r.error }
          return { ok: true, result: r.result, ...(r.type ? { type: r.type } : {}) }
        } catch (err) {
          return fail(err)
        }
      },
      async stop(key: unknown): Promise<{ ok: boolean; error?: string }> {
        try {
          if (typeof key !== 'string') return { ok: false, error: 'Invalid session key' }
          await getDebugManager().stop(key)
          return { ok: true }
        } catch (err) {
          return fail(err)
        }
      },
      list() {
        return getDebugManager().list()
      },
      async stopAll(): Promise<void> {
        await getDebugManager().stopAll().catch(() => {})
      }
    },

    codeIndex: {
      async search(root: unknown, queries: unknown, o?: unknown): Promise<Ok<{ hits: SearchHit[]; text: string; chunks: number }> | Fail> {
        const r = validProjectRoot(root)
        if (!r) return { ok: false, error: 'Invalid project root' }
        const qs = (Array.isArray(queries) ? queries : [queries]).filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 8)
        if (!qs.length) return { ok: false, error: 'query is required' }
        try {
          const index = await ensureIndex(r, 15_000)
          const oo = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
          const hits = index.search(qs, {
            limit: Math.max(1, Math.min(30, Math.floor(Number(oo.limit) || 10))),
            ...(typeof oo.pathPrefix === 'string' && oo.pathPrefix ? { pathPrefix: oo.pathPrefix } : {})
          })
          return { ok: true, hits, text: formatSearchHits(hits), chunks: index.chunkCount }
        } catch (err) {
          return fail(err)
        }
      },
      async update(root: unknown): Promise<Ok<{ files: number; chunks: number; ms: number }> | Fail> {
        const r = validProjectRoot(root)
        if (!r) return { ok: false, error: 'Invalid project root' }
        try {
          const t0 = Date.now()
          const index = await ensureIndex(r, 0)
          return { ok: true, files: index.fileCount, chunks: index.chunkCount, ms: Date.now() - t0 }
        } catch (err) {
          return fail(err)
        }
      }
    },

    tests: {
      async affected(root: unknown, files: unknown, o?: unknown): Promise<Ok<{ text: string; tests: string[]; commands: Array<{ runner: string; command: string }> }> | Fail> {
        const r = validProjectRoot(root)
        if (!r) return { ok: false, error: 'Invalid project root' }
        const list = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string' && !!f).slice(0, 200) : []
        if (!list.length) return { ok: false, error: 'No changed files given' }
        try {
          const oo = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
          const res = await findAffectedTests(r, list, {
            maxDepth: typeof oo.maxDepth === 'number' ? oo.maxDepth : undefined,
            limit: typeof oo.limit === 'number' ? oo.limit : undefined
          })
          return {
            ok: true,
            text: formatAffectedTests(res),
            tests: res.tests.map((t) => t.path),
            commands: res.commands.map((c) => ({ runner: c.runner, command: c.command }))
          }
        } catch (err) {
          return fail(err)
        }
      }
    },

    net: {
      async probePort(port: unknown, host?: unknown): Promise<{ ok: boolean; open: boolean }> {
        const open = await probePort(Math.floor(Number(port)), typeof host === 'string' ? host : '127.0.0.1')
        return { ok: true, open }
      }
    },

    outputs: {
      async save(sessionId: unknown, content: unknown): Promise<Ok<{ id: string; chars: number; lines: number }> | Fail> {
        if (typeof content !== 'string') return { ok: false, error: 'content must be a string' }
        const sid = typeof sessionId === 'string' && SAFE_ID.test(sessionId) ? sessionId : 'default'
        const id = `out_${randomBytes(4).toString('hex')}`
        const text = content.length > 20_000_000 ? content.slice(0, 20_000_000) : content
        try {
          if (outputsDir) {
            void pruneOutputs()
            const dir = join(outputsDir, hashKey(sid))
            await mkdir(dir, { recursive: true })
            await writeFile(join(dir, `${id}.txt`), text, { encoding: 'utf8', mode: 0o600 })
            memOutputs.set(id, join(dir, `${id}.txt`))
          } else {
            memOutputs.set(id, text)
          }
          return { ok: true, id, chars: text.length, lines: text.split('\n').length }
        } catch (err) {
          return fail(err)
        }
      },
      async read(id: unknown, o?: unknown): Promise<Ok<{ text: string }> | Fail> {
        if (typeof id !== 'string' || !/^out_[0-9a-f]{8}$/.test(id)) return { ok: false, error: 'Unknown output id' }
        try {
          let full: string | undefined
          const mem = memOutputs.get(id)
          if (outputsDir) {
            let file = mem
            if (!file) {
              // After a restart: search the per-session dirs.
              for (const d of await readdir(outputsDir).catch(() => [] as string[])) {
                const p = join(outputsDir, d, `${id}.txt`)
                if (await stat(p).catch(() => null)) {
                  file = p
                  break
                }
              }
            }
            if (file) full = await readFile(file, 'utf8')
          } else {
            full = mem
          }
          if (full === undefined) return { ok: false, error: `Output ${id} not found (outputs are kept 7 days).` }
          return { ok: true, text: readOutputSlice(full, (o && typeof o === 'object' ? o : {}) as OutputReadOptions) }
        } catch (err) {
          return fail(err)
        }
      }
    },

    profile: {
      async get(root: unknown): Promise<{ ok: boolean; json: string | null; error?: string }> {
        const r = validProjectRoot(root)
        if (!r) return { ok: false, json: null, error: 'Invalid project root' }
        if (!profilesDir) return { ok: true, json: memProfiles.get(r) ?? null }
        try {
          return { ok: true, json: await readFile(join(profilesDir, `${hashKey(r)}.json`), 'utf8') }
        } catch {
          return { ok: true, json: null }
        }
      },
      async save(root: unknown, json: unknown): Promise<{ ok: boolean; error?: string }> {
        const r = validProjectRoot(root)
        if (!r) return { ok: false, error: 'Invalid project root' }
        if (typeof json !== 'string' || json.length > 400_000) return { ok: false, error: 'Invalid profile' }
        try {
          JSON.parse(json)
        } catch {
          return { ok: false, error: 'Profile is not valid JSON' }
        }
        if (!profilesDir) {
          memProfiles.set(r, json)
          return { ok: true }
        }
        try {
          await mkdir(profilesDir, { recursive: true })
          await writeFile(join(profilesDir, `${hashKey(r)}.json`), json, 'utf8')
          return { ok: true }
        } catch (err) {
          return fail(err)
        }
      }
    },

    async dispose(): Promise<void> {
      getBashSessionManager().killAll()
      await getDebugManager().stopAll().catch(() => {})
    }
  }
}

export type AgentRuntime = ReturnType<typeof createAgentRuntime>
