/**
 * Client for the native macOS computer-use helper (native/macos/pawn-cua).
 *
 * The helper is a long-lived Swift process speaking JSON Lines on stdio:
 * requests {id, method, params} → responses {id, result | error}, plus
 * unsolicited events ({event: "ready" | "user_abort"}). Keeping one process
 * alive makes every action a ~1–10 ms IPC hop instead of spawning cliclick /
 * osascript per click, and lets the helper keep AX element handles between
 * calls (element-indexed clicking).
 *
 * No Electron imports here, so it can be tested in plain Node.
 */

import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'

export class CuaError extends Error {
  constructor(
    message: string,
    readonly code: string = 'failed'
  ) {
    super(message)
    this.name = 'CuaError'
  }
}

export type CuaSpawn = (file: string) => ChildProcess

/** Where to look for the helper binary, most specific first. */
export function helperCandidates(opts: {
  env?: Record<string, string | undefined>
  resourcesPath?: string
  appPath?: string
  cwd?: string
}): string[] {
  const out: string[] = []
  const env = opts.env ?? process.env
  if (env.PAWN_CUA_PATH) out.push(env.PAWN_CUA_PATH)
  if (opts.resourcesPath) out.push(join(opts.resourcesPath, 'bin', 'pawn-cua'))
  for (const root of [opts.appPath, opts.cwd]) {
    if (!root) continue
    out.push(join(root, 'native', 'macos', 'build', 'pawn-cua'))
    // app.getAppPath() is <root>/out/main in some dev layouts.
    out.push(join(root, '..', '..', 'native', 'macos', 'build', 'pawn-cua'))
  }
  return Array.from(new Set(out))
}

export function findHelper(candidates: string[], exists: (p: string) => boolean = existsSync): string | null {
  return candidates.find((p) => exists(p)) ?? null
}

/** Per-method timeouts: long actions get their own duration plus slack. */
export function timeoutFor(method: string, params: Record<string, unknown> = {}): number {
  const n = (k: string): number => (typeof params[k] === 'number' && Number.isFinite(params[k]) ? (params[k] as number) : 0)
  switch (method) {
    case 'wait':
      return n('ms') + 5_000
    case 'hold_key':
      return n('durationMs') + 5_000
    case 'drag':
      return n('durationMs') + 8_000
    case 'type': {
      const text = typeof params.text === 'string' ? params.text : ''
      return 10_000 + text.length * 25
    }
    case 'launch':
    case 'open':
      return 30_000
    case 'ocr':
    case 'find_text':
      return 25_000
    case 'screenshot':
    case 'zoom':
    case 'ui_snapshot':
    case 'ui_find':
      return 20_000
    default:
      return 12_000
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

export interface CuaHelperOptions {
  /** Resolved helper path (null → unavailable). */
  path: string | null
  spawn?: CuaSpawn
  /** Max restarts within `restartWindowMs` before giving up. */
  maxRestarts?: number
  restartWindowMs?: number
}

export class CuaHelper extends EventEmitter {
  private proc: ChildProcess | null = null
  private buf = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private restarts: number[] = []
  private readyPromise: Promise<void> | null = null
  private disposed = false
  lastError: string | null = null
  readyInfo: Record<string, unknown> | null = null

  constructor(private readonly opts: CuaHelperOptions) {
    super()
  }

  get path(): string | null {
    return this.opts.path
  }

  get isAvailable(): boolean {
    return !!this.opts.path && !this.disposed && !this.gaveUp()
  }

  private gaveUp(): boolean {
    const window = this.opts.restartWindowMs ?? 60_000
    const max = this.opts.maxRestarts ?? 5
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < window)
    return this.restarts.length >= max
  }

  private start(): Promise<void> {
    if (this.readyPromise && this.proc && this.proc.exitCode === null) return this.readyPromise
    if (!this.opts.path) return Promise.reject(new CuaError('Computer-use helper is not installed', 'unavailable'))
    if (this.gaveUp()) {
      return Promise.reject(new CuaError(`Computer-use helper keeps crashing: ${this.lastError || 'unknown error'}`, 'unavailable'))
    }
    this.restarts.push(Date.now())
    const spawnFn: CuaSpawn = this.opts.spawn ?? ((file) => spawn(file, [], { stdio: ['pipe', 'pipe', 'pipe'] }))
    const proc = spawnFn(this.opts.path)
    this.proc = proc
    this.buf = ''
    let stderrTail = ''
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CuaError('Computer-use helper did not start (timeout)', 'unavailable'))
      }, 8_000)
      const onReady = (info: Record<string, unknown>): void => {
        clearTimeout(timer)
        this.readyInfo = info
        resolve()
      }
      this.once('ready', onReady)
      proc.once('error', (err) => {
        clearTimeout(timer)
        this.lastError = err.message
        reject(new CuaError(`Computer-use helper failed to start: ${err.message}`, 'unavailable'))
      })
      proc.once('exit', (code, signal) => {
        clearTimeout(timer)
        this.off('ready', onReady)
        reject(new CuaError(`Computer-use helper exited (${signal || code})`, 'unavailable'))
      })
    })
    // Avoid unhandled rejections when nobody awaits a failed start.
    this.readyPromise.catch(() => {})
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => this.onData(chunk))
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (c: string) => {
      stderrTail = (stderrTail + c).slice(-2000)
    })
    proc.stdin?.on('error', () => {})
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null
      this.lastError = `exited (${signal || code})${stderrTail ? `: ${stderrTail.trim().slice(-300)}` : ''}`
      for (const [id, p] of Array.from(this.pending.entries())) {
        clearTimeout(p.timer)
        p.reject(new CuaError(`Computer-use helper stopped during ${p.method}: ${this.lastError}`, 'crashed'))
        this.pending.delete(id)
      }
      this.emit('exit', code, signal)
    })
    return this.readyPromise
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof msg.event === 'string') {
        this.emit(msg.event, msg)
        this.emit('event', msg)
        continue
      }
      const id = typeof msg.id === 'number' ? msg.id : NaN
      const p = this.pending.get(id)
      if (!p) continue
      this.pending.delete(id)
      clearTimeout(p.timer)
      if (msg.error && typeof msg.error === 'object') {
        const e = msg.error as { code?: string; message?: string }
        p.reject(new CuaError(e.message || 'Computer action failed', e.code || 'failed'))
      } else {
        p.resolve(msg.result)
      }
    }
  }

  async call<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (this.disposed) throw new CuaError('Computer-use helper was shut down', 'unavailable')
    await this.start()
    const proc = this.proc
    if (!proc?.stdin) throw new CuaError('Computer-use helper is not running', 'unavailable')
    const id = this.nextId++
    const limit = timeoutMs ?? timeoutFor(method, params)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CuaError(`${method} timed out after ${Math.round(limit / 1000)}s`, 'timeout'))
      }, limit)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, method })
      proc.stdin!.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  dispose(): void {
    this.disposed = true
    const proc = this.proc
    this.proc = null
    for (const p of Array.from(this.pending.values())) {
      clearTimeout(p.timer)
      p.reject(new CuaError('Computer-use helper was shut down', 'unavailable'))
    }
    this.pending.clear()
    if (proc && proc.exitCode === null) {
      try {
        proc.stdin?.end()
      } catch {
        /* ignore */
      }
      const t = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          /* gone */
        }
      }, 800)
      t.unref?.()
    }
  }
}
