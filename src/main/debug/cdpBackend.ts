import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
// `ws` ships no bundled types and @types/ws is not a dependency. Load it via
// createRequire and describe the minimal surface we use, so this stays a pure,
// dependency-free import with no ambient .d.ts file.
const require = createRequire(import.meta.url)

interface WsLike {
  readyState: number
  on(event: string, cb: (...args: unknown[]) => void): void
  send(data: string): void
  close(): void
}
interface WsCtor {
  new (url: string, opts?: { perMessageDeflate?: boolean }): WsLike
  readonly OPEN: number
}
const WebSocket = require('ws') as WsCtor
type RawData = string | Buffer | ArrayBuffer | Buffer[]

import { resolveNodeBinary, buildEnv } from './adapters'
import type {
  DebugBreakpoint,
  DebugFrame,
  DebugStartOptions,
  DebugVariable
} from './types'

/**
 * A Node.js debug backend built directly on the V8 inspector (Chrome DevTools
 * Protocol) over a WebSocket. js-debug is not bundled, so we drive the
 * inspector ourselves: spawn `node --inspect-brk`, connect, set breakpoints,
 * and translate CDP pause/resume semantics into the shared debugger vocabulary.
 */

interface CdpPending {
  resolve: (result: Record<string, unknown>) => void
  reject: (err: Error) => void
}

const NOISE_PATTERNS = [
  /^Debugger listening on ws:\/\//,
  /^For help, see: https:\/\/nodejs\.org\/en\/docs\/inspector/,
  /^Debugger attached\.?$/,
  /^Waiting for the debugger to disconnect\.\.\.$/
]

export interface CdpStopEvent {
  reason: string
  description?: string
  threadId: number
  frames: DebugFrame[]
  callFrameIds: string[]
  exception?: string
}

export class CdpBackend extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private ws: WsLike | null = null
  private msgId = 1
  private readonly pending = new Map<number, CdpPending>()
  private readonly opts: DebugStartOptions
  private wsUrl: string | null = null
  private readonly bpIds: string[] = []
  private stopOnEntry: boolean
  private firstPauseHandled = false
  private terminated = false
  private exitCode: number | undefined
  private outputBuffer = ''
  private lastFrames: DebugFrame[] = []
  private lastCallFrameIds: string[] = []
  private lastScopeChain: Array<Record<string, unknown>> = []
  private stderrPreamble = ''

  constructor(opts: DebugStartOptions) {
    super()
    this.opts = opts
    this.stopOnEntry = Boolean(opts.stopOnEntry)
  }

  /** Spawn node under the inspector, connect the websocket, and enable domains. */
  async launch(): Promise<void> {
    const nodeBin = resolveNodeBinary(this.opts)
    const env = buildEnv(this.opts.env)
    const runtimeArgs = this.opts.runtimeArgs ?? []
    const args = ['--inspect-brk=127.0.0.1:0', ...runtimeArgs, this.opts.program, ...(this.opts.args ?? [])]
    const child = spawn(nodeBin, args, {
      cwd: this.opts.cwd,
      env
    }) as ChildProcessWithoutNullStreams
    this.child = child
    // A spawn failure (missing node binary, EACCES) is an async 'error' event;
    // log it so the wait timeout is not the only symptom.
    child.on('error', (err) => {
      console.error('[cdp] node spawn failed:', err)
      this.terminated = true
      this.emit('terminated', -1)
    })

    const wsUrl = await this.waitForWsUrl(child)
    this.wsUrl = wsUrl

    child.stdout.on('data', (d: Buffer) => this.captureOutput(d.toString()))
    child.stderr.on('data', (d: Buffer) => this.captureStderr(d.toString()))
    child.on('exit', (code) => {
      this.terminated = true
      this.exitCode = code ?? undefined
      this.emit('terminated', this.exitCode)
      this.closeWs()
    })

    await this.connect(wsUrl)
    await this.send('Runtime.enable')
    await this.send('Debugger.enable')
    await this.send('Debugger.setPauseOnExceptions', { state: 'uncaught' })
  }

  private waitForWsUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false
      let acc = ''
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Timed out waiting for the Node inspector WebSocket URL'))
      }, this.opts.timeoutMs ?? 15000)
      if (typeof timer.unref === 'function') timer.unref()
      const onData = (d: Buffer): void => {
        acc += d.toString()
        this.stderrPreamble += d.toString()
        const m = /Debugger listening on (ws:\/\/[^\s]+)/.exec(acc)
        if (m && !settled) {
          settled = true
          clearTimeout(timer)
          child.stderr.off('data', onData)
          resolve(m[1])
        }
      }
      child.stderr.on('data', onData)
      child.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`Node exited (code ${code ?? 'null'}) before the inspector was ready`))
      })
    })
  }

  private connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false })
      this.ws = ws
      ws.on('open', () => resolve())
      ws.on('error', (...args: unknown[]) => {
        const err = args[0] instanceof Error ? args[0] : new Error(String(args[0]))
        if (this.ws === ws && !this.terminated) this.emit('error', err)
        reject(err)
      })
      ws.on('message', (...args: unknown[]) => {
        const data = args[0] as RawData
        this.onMessage(data.toString())
      })
      ws.on('close', () => {
        // If the script finished but node is holding for the debugger, the exit
        // handler already fired; nothing more to do here.
      })
    })
  }

  private onMessage(text: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        if (msg.error) {
          const err = msg.error as { message?: string }
          pending.reject(new Error(err.message ?? 'CDP error'))
        } else {
          pending.resolve((msg.result as Record<string, unknown>) ?? {})
        }
      }
      return
    }
    const method = msg.method as string | undefined
    if (!method) return
    const params = (msg.params as Record<string, unknown>) ?? {}
    if (method === 'Debugger.paused') {
      void this.handlePaused(params)
    }
    // Program stdout/stderr is captured from the child process pipes directly,
    // so Runtime.consoleAPICalled / exceptionThrown events are not needed here.
  }

  private send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`CDP not connected; cannot send "${method}"`))
        return
      }
      const id = this.msgId++
      this.pending.set(id, {
        resolve: resolve as (r: Record<string, unknown>) => void,
        reject
      })
      ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
  }

  /** Set breakpoints (replaces all existing ones). */
  async setBreakpoints(breakpoints: DebugBreakpoint[]): Promise<void> {
    for (const id of this.bpIds) {
      try {
        await this.send('Debugger.removeBreakpoint', { breakpointId: id })
      } catch {
        // ignore
      }
    }
    this.bpIds.length = 0
    for (const bp of breakpoints) {
      const abs = isAbsolute(bp.path) ? bp.path : resolvePath(this.opts.cwd, bp.path)
      const fileUrl = pathToFileURL(abs).href
      const lineNumber = bp.line - 1
      // file:// URL variant (ESM).
      try {
        const res = await this.send<{ breakpointId?: string }>('Debugger.setBreakpointByUrl', {
          url: fileUrl,
          lineNumber,
          condition: bp.condition
        })
        if (res.breakpointId) this.bpIds.push(res.breakpointId)
      } catch {
        // ignore
      }
      // urlRegex variant so plain-path CJS script URLs also match.
      try {
        const escaped = abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const res = await this.send<{ breakpointId?: string }>('Debugger.setBreakpointByUrl', {
          urlRegex: `(file://)?${escaped}`,
          lineNumber,
          condition: bp.condition
        })
        if (res.breakpointId) this.bpIds.push(res.breakpointId)
      } catch {
        // ignore
      }
    }
  }

  /** Run the paused-on-start program. Resumes past the entry break unless stopOnEntry. */
  async run(): Promise<void> {
    await this.send('Runtime.runIfWaitingForDebugger')
  }

  private async handlePaused(params: Record<string, unknown>): Promise<void> {
    const callFrames = (params.callFrames as Array<Record<string, unknown>>) ?? []
    const reason = (params.reason as string) ?? 'other'
    const data = params.data as Record<string, unknown> | undefined

    if (!this.firstPauseHandled) {
      this.firstPauseHandled = true
      if (!this.stopOnEntry) {
        // The first pause is "Break on start"; skip it.
        await this.send('Debugger.resume').catch(() => {})
        return
      }
    }

    const frames: DebugFrame[] = []
    const callFrameIds: string[] = []
    const scopeChains: Array<Record<string, unknown>> = []
    let idx = 0
    for (const cf of callFrames) {
      const location = cf.location as { lineNumber?: number; columnNumber?: number } | undefined
      const url = (cf.url as string) ?? ''
      let path: string | undefined
      if (url.startsWith('file://')) {
        try {
          path = fileURLToPath(url)
        } catch {
          path = undefined
        }
      } else if (url) {
        path = url
      }
      frames.push({
        id: idx,
        name: (cf.functionName as string) || '(anonymous)',
        path,
        line: (location?.lineNumber ?? 0) + 1,
        column: (location?.columnNumber ?? 0) + 1
      })
      callFrameIds.push(cf.callFrameId as string)
      if (idx === 0) {
        this.lastScopeChain = (cf.scopeChain as Array<Record<string, unknown>>) ?? []
      }
      scopeChains.push(cf)
      idx++
      if (idx >= 20) break
    }
    this.lastFrames = frames
    this.lastCallFrameIds = callFrameIds

    let exception: string | undefined
    if ((reason === 'exception' || reason === 'promiseRejection') && data) {
      exception = (data.description as string) || (data.value as string) || 'Exception'
    }

    const stop: CdpStopEvent = {
      reason: this.mapReason(reason),
      description: reason,
      threadId: 1,
      frames,
      callFrameIds,
      exception
    }
    this.emit('stopped', stop)
  }

  private mapReason(cdpReason: string): string {
    switch (cdpReason) {
      case 'other':
        return 'breakpoint'
      case 'exception':
      case 'promiseRejection':
        return 'exception'
      case 'ambiguous':
        return 'breakpoint'
      default:
        return cdpReason
    }
  }

  /** Read the top-frame local variables from the last pause. */
  async getLocals(): Promise<DebugVariable[]> {
    // Merge innermost block scopes and the function-local scope so loop-local
    // and lexically-scoped variables are visible alongside function locals.
    // Inner scopes come first in scopeChain, so earlier entries win on name
    // collisions (the closest binding to the current statement).
    const scopes = this.lastScopeChain.filter((s) => {
      const type = (s as { type?: string }).type
      return type === 'local' || type === 'block' || type === 'catch'
    })
    if (scopes.length === 0) return []
    const out: DebugVariable[] = []
    const seen = new Set<string>()
    for (const scope of scopes) {
      const obj = (scope as { object?: { objectId?: string } }).object
      if (!obj?.objectId) continue
      let res: { result?: Array<Record<string, unknown>> }
      try {
        res = await this.send('Runtime.getProperties', {
          objectId: obj.objectId,
          ownProperties: true
        })
      } catch {
        continue
      }
      for (const prop of res.result ?? []) {
        const name = prop.name as string
        if (seen.has(name)) continue
        seen.add(name)
        const value = prop.value as Record<string, unknown> | undefined
        out.push({ name, value: formatCdpValue(value), type: value?.type as string | undefined })
        if (out.length >= 50) return out
      }
    }
    return out
  }

  async evaluate(expression: string, frameIndex?: number): Promise<{ result: string; type?: string; error?: string }> {
    const cfId = this.lastCallFrameIds[frameIndex ?? 0]
    try {
      if (cfId) {
        const res = await this.send<{ result?: Record<string, unknown>; exceptionDetails?: Record<string, unknown> }>(
          'Debugger.evaluateOnCallFrame',
          { callFrameId: cfId, expression, returnByValue: false }
        )
        if (res.exceptionDetails) {
          return { result: '', error: describeException(res.exceptionDetails) }
        }
        return { result: formatCdpValue(res.result), type: (res.result?.type as string) }
      }
      const res = await this.send<{ result?: Record<string, unknown>; exceptionDetails?: Record<string, unknown> }>(
        'Runtime.evaluate',
        { expression, returnByValue: false }
      )
      if (res.exceptionDetails) {
        return { result: '', error: describeException(res.exceptionDetails) }
      }
      return { result: formatCdpValue(res.result), type: (res.result?.type as string) }
    } catch (err) {
      return { result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }

  async resume(): Promise<void> {
    await this.send('Debugger.resume').catch(() => {})
  }

  async stepOver(): Promise<void> {
    await this.send('Debugger.stepOver').catch(() => {})
  }

  async stepInto(): Promise<void> {
    await this.send('Debugger.stepInto').catch(() => {})
  }

  async stepOut(): Promise<void> {
    await this.send('Debugger.stepOut').catch(() => {})
  }

  async pause(): Promise<void> {
    await this.send('Debugger.pause').catch(() => {})
  }

  private captureOutput(text: string): void {
    this.appendOutput(text)
  }

  private captureStderr(text: string): void {
    const lines = text.split(/\r?\n/)
    const kept: string[] = []
    for (const line of lines) {
      if (line === '') continue
      if (NOISE_PATTERNS.some((re) => re.test(line))) {
        // If node is waiting for the debugger to disconnect, let it exit.
        if (/^Waiting for the debugger to disconnect\.\.\.$/.test(line)) {
          this.closeWs()
        }
        continue
      }
      kept.push(line)
    }
    if (kept.length) this.appendOutput(kept.join('\n') + '\n')
  }

  private appendOutput(text: string): void {
    this.outputBuffer += text
    this.emit('output', text)
  }

  /** Drain and return new output since the last drain (capped, tail kept). */
  drainOutput(cap = 4000): string {
    let out = this.outputBuffer
    this.outputBuffer = ''
    if (out.length > cap) out = out.slice(out.length - cap)
    return out
  }

  get frames(): DebugFrame[] {
    return this.lastFrames
  }

  get isTerminated(): boolean {
    return this.terminated
  }

  get code(): number | undefined {
    return this.exitCode
  }

  private closeWs(): void {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    this.closeWs()
    const child = this.child
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
    for (const [, p] of Array.from(this.pending.entries())) {
      p.reject(new Error('CDP backend disposed'))
    }
    this.pending.clear()
  }
}

/** Format a CDP RemoteObject into a compact display string. */
export function formatCdpValue(value: Record<string, unknown> | undefined): string {
  if (!value) return 'undefined'
  const type = value.type as string
  if (type === 'undefined') return 'undefined'
  if (value.unserializableValue) return String(value.unserializableValue)
  if (type === 'string') return JSON.stringify(value.value)
  if (type === 'number' || type === 'boolean') return String(value.value)
  if (type === 'object') {
    if (value.subtype === 'null') return 'null'
    return (value.description as string) || (value.className as string) || 'object'
  }
  if (type === 'function') return (value.description as string) || 'function'
  if (value.value !== undefined) return String(value.value)
  return (value.description as string) || type || 'unknown'
}

function describeException(details: Record<string, unknown>): string {
  const exception = details.exception as Record<string, unknown> | undefined
  if (exception) {
    return (exception.description as string) || (exception.value as string) || 'Exception'
  }
  return (details.text as string) || 'Exception'
}
