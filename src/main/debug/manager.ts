import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { DapClient } from './dapClient'
import { CdpBackend, type CdpStopEvent } from './cdpBackend'
import {
  buildLaunchArgs,
  resolveDapAdapter,
  resolveLanguage,
  type ResolvedDapAdapter
} from './adapters'
import type {
  DebugBreakpoint,
  DebugFrame,
  DebugLanguage,
  DebugStartOptions,
  DebugState,
  DebugVariable
} from './types'

const MAX_SESSIONS = 4
const DEFAULT_RUN_TIMEOUT = 15000

// --------------------------------------------------------------------------
// Session interface shared by the DAP and CDP implementations.
// --------------------------------------------------------------------------

interface DebugSession {
  readonly key: string
  readonly language: DebugLanguage
  start(): Promise<DebugState>
  setBreakpoints(path: string, bps: Array<{ line: number; condition?: string }>): Promise<DebugState>
  continue(timeoutMs: number): Promise<DebugState>
  step(kind: 'over' | 'into' | 'out', timeoutMs: number): Promise<DebugState>
  pause(): Promise<DebugState>
  state(): DebugState
  evaluate(expression: string, frameId?: number): Promise<{ result: string; type?: string; error?: string }>
  stop(): Promise<void>
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const sourceCache = new Map<string, string[]>()

function readSourceLines(path: string): string[] | null {
  if (!path) return null
  if (sourceCache.has(path)) return sourceCache.get(path)!
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    sourceCache.set(path, lines)
    return lines
  } catch {
    return null
  }
}

function buildSourceSnippet(path: string | undefined, line: number): string | undefined {
  if (!path || !line) return undefined
  const lines = readSourceLines(path)
  if (!lines) return undefined
  const start = Math.max(1, line - 5)
  const end = Math.min(lines.length, line + 5)
  const width = String(end).length
  const out: string[] = []
  for (let n = start; n <= end; n++) {
    const marker = n === line ? '→' : ' '
    const num = String(n).padStart(width, ' ')
    out.push(`${marker} ${num} | ${lines[n - 1] ?? ''}`)
  }
  return out.join('\n')
}

function capValue(v: string, cap = 200): string {
  if (v.length <= cap) return v
  return v.slice(0, cap) + '…'
}

// --------------------------------------------------------------------------
// CDP-backed Node session
// --------------------------------------------------------------------------

class NodeSession implements DebugSession {
  readonly key: string
  readonly language: DebugLanguage = 'node'
  private readonly backend: CdpBackend
  private readonly opts: DebugStartOptions
  private status: DebugState['status'] = 'starting'
  private lastStop: CdpStopEvent | null = null
  private locals: DebugVariable[] = []
  private exitCode: number | undefined
  private breakpoints: DebugBreakpoint[]
  private verifiedBps: Array<{ path: string; line: number; verified: boolean; message?: string }> = []
  private waiters: Array<() => void> = []

  constructor(opts: DebugStartOptions) {
    this.key = opts.sessionKey
    this.opts = opts
    this.backend = new CdpBackend(opts)
    this.breakpoints = opts.breakpoints ? [...opts.breakpoints] : []
    this.backend.on('stopped', (ev: CdpStopEvent) => {
      this.lastStop = ev
      this.status = 'stopped'
      void this.refreshLocals().finally(() => this.notify())
    })
    this.backend.on('terminated', (code?: number) => {
      this.status = 'terminated'
      this.exitCode = code
      this.notify()
    })
  }

  private notify(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w()
  }

  private async refreshLocals(): Promise<void> {
    try {
      this.locals = (await this.backend.getLocals()).map((l) => ({
        ...l,
        value: capValue(l.value)
      }))
    } catch {
      this.locals = []
    }
  }

  private waitForStop(timeoutMs: number): Promise<void> {
    if (this.status === 'stopped' || this.status === 'terminated') return Promise.resolve()
    return new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.waiters.push(finish)
    })
  }

  async start(): Promise<DebugState> {
    await this.backend.launch()
    await this.backend.setBreakpoints(this.breakpoints)
    this.verifiedBps = this.breakpoints.map((b) => ({ path: b.path, line: b.line, verified: true }))
    const stopPromise = this.waitForStop(this.opts.timeoutMs ?? 2000)
    await this.backend.run()
    await stopPromise
    if (this.status === 'starting') this.status = 'running'
    return this.state()
  }

  async setBreakpoints(
    path: string,
    bps: Array<{ line: number; condition?: string }>
  ): Promise<DebugState> {
    this.breakpoints = this.breakpoints.filter((b) => b.path !== path)
    for (const b of bps) this.breakpoints.push({ path, line: b.line, condition: b.condition })
    await this.backend.setBreakpoints(this.breakpoints)
    this.verifiedBps = this.breakpoints.map((b) => ({ path: b.path, line: b.line, verified: true }))
    return this.state()
  }

  async continue(timeoutMs: number): Promise<DebugState> {
    if (this.status === 'terminated') return this.state()
    this.status = 'running'
    const wait = this.waitForStop(timeoutMs)
    await this.backend.resume()
    await wait
    return this.state()
  }

  async step(kind: 'over' | 'into' | 'out', timeoutMs: number): Promise<DebugState> {
    if (this.status === 'terminated') return this.state()
    this.status = 'running'
    const wait = this.waitForStop(timeoutMs)
    if (kind === 'over') await this.backend.stepOver()
    else if (kind === 'into') await this.backend.stepInto()
    else await this.backend.stepOut()
    await wait
    return this.state()
  }

  async pause(): Promise<DebugState> {
    if (this.status === 'terminated') return this.state()
    const wait = this.waitForStop(5000)
    await this.backend.pause()
    await wait
    return this.state()
  }

  state(): DebugState {
    const top = this.lastStop?.frames[0]
    const location = top
      ? { path: top.path, line: top.line, column: top.column, function: top.name }
      : undefined
    const source =
      this.status === 'stopped' && top ? buildSourceSnippet(top.path, top.line) : undefined
    const st: DebugState = {
      sessionKey: this.key,
      language: this.language,
      status: this.status,
      output: this.backend.drainOutput(),
      breakpoints: this.verifiedBps
    }
    if (this.status === 'stopped' && this.lastStop) {
      st.reason = this.lastStop.reason
      st.description = this.lastStop.description
      st.threadId = this.lastStop.threadId
      st.location = location
      st.source = source
      st.stack = this.lastStop.frames.slice(0, 20)
      st.locals = this.locals.slice(0, 50)
      if (this.lastStop.exception) st.exception = this.lastStop.exception
    }
    if (this.status === 'terminated') st.exitCode = this.exitCode
    return st
  }

  async evaluate(
    expression: string,
    frameId?: number
  ): Promise<{ result: string; type?: string; error?: string }> {
    return this.backend.evaluate(expression, frameId)
  }

  async stop(): Promise<void> {
    this.backend.dispose()
    this.status = 'terminated'
  }
}

// --------------------------------------------------------------------------
// DAP-backed session (python / go / lldb)
// --------------------------------------------------------------------------

class DapSession implements DebugSession {
  readonly key: string
  readonly language: DebugLanguage
  private readonly opts: DebugStartOptions
  private readonly adapter: ResolvedDapAdapter
  private client: DapClient | null = null
  private child: ChildProcess | null = null
  private socket: Socket | null = null
  private status: DebugState['status'] = 'starting'
  private capabilities: Record<string, unknown> = {}
  private breakpoints: DebugBreakpoint[]
  private verifiedBps: Array<{ path: string; line: number; verified: boolean; message?: string }> = []
  private outputBuffer = ''
  private stopReason: string | undefined
  private stopDescription: string | undefined
  private threadId: number | undefined
  private stack: DebugFrame[] = []
  private locals: DebugVariable[] = []
  private exceptionText: string | undefined
  private exitCode: number | undefined
  private waiters: Array<() => void> = []
  private initializedResolved = false

  constructor(language: DebugLanguage, opts: DebugStartOptions, adapter: ResolvedDapAdapter) {
    this.key = opts.sessionKey
    this.language = language
    this.opts = opts
    this.adapter = adapter
    this.breakpoints = opts.breakpoints ? [...opts.breakpoints] : []
  }

  private notify(): void {
    const w = this.waiters
    this.waiters = []
    for (const fn of w) fn()
  }

  private waitForEvent(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.waiters.push(finish)
    })
  }

  private async setupTransport(): Promise<DapClient> {
    if (this.adapter.transport === 'stdio') {
      const child = spawn(this.adapter.command!, this.adapter.args ?? [], {
        cwd: this.opts.cwd,
        env: this.adapter.env
      })
      this.child = child
      child.on('exit', (code) => {
        if (this.status !== 'terminated') {
          this.status = 'terminated'
          this.exitCode = this.exitCode ?? code ?? undefined
          this.notify()
        }
      })
      const client = new DapClient(child.stdout!, child.stdin!)
      // Also capture adapter stderr as diagnostic output.
      child.stderr?.on('data', () => {})
      return client
    }
    // tcp: spawn the server, parse the port, connect.
    const port = await this.spawnTcpServer()
    const socket = createConnection({ host: '127.0.0.1', port })
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    return new DapClient(socket, socket)
  }

  private spawnTcpServer(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const child = spawn(this.adapter.spawnCommand!, this.adapter.spawnArgs ?? [], {
        cwd: this.opts.cwd,
        env: this.adapter.env
      })
      this.child = child
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Timed out waiting for the DAP TCP server to announce its port'))
      }, this.opts.timeoutMs ?? 15000)
      if (typeof timer.unref === 'function') timer.unref()
      const scan = (buf: Buffer): void => {
        const m = this.adapter.portRegex?.exec(buf.toString())
        if (m && !settled) {
          settled = true
          clearTimeout(timer)
          resolve(parseInt(m[1], 10))
        }
      }
      child.stdout?.on('data', scan)
      child.stderr?.on('data', scan)
      child.on('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`DAP server exited (code ${code ?? 'null'}) before announcing a port`))
        }
      })
    })
  }

  private wireEvents(client: DapClient): void {
    client.on('event:output', (body: { category?: string; output?: string }) => {
      const cat = body?.category
      if (cat === 'stdout' || cat === 'stderr' || cat === 'console') {
        this.outputBuffer += body.output ?? ''
      }
    })
    client.on('event:stopped', (body: Record<string, unknown>) => {
      this.status = 'stopped'
      this.stopReason = body.reason as string
      this.stopDescription = (body.description as string) || (body.text as string)
      this.threadId = body.threadId as number
      if (body.reason === 'exception') {
        this.exceptionText = (body.description as string) || (body.text as string) || 'Exception'
      }
      void this.refreshStopState().finally(() => this.notify())
    })
    client.on('event:terminated', () => {
      if (this.status !== 'terminated') {
        this.status = 'terminated'
        this.notify()
      }
    })
    client.on('event:exited', (body: { exitCode?: number }) => {
      this.exitCode = body?.exitCode
    })
  }

  private async refreshStopState(): Promise<void> {
    const client = this.client
    if (!client || this.threadId === undefined) return
    try {
      const stackRes = await client.request<{ stackFrames?: Array<Record<string, unknown>> }>(
        'stackTrace',
        { threadId: this.threadId, startFrame: 0, levels: 20 }
      )
      const frames = stackRes.stackFrames ?? []
      this.stack = frames.map((f) => ({
        id: f.id as number,
        name: (f.name as string) ?? '',
        path: (f.source as { path?: string } | undefined)?.path,
        line: (f.line as number) ?? 0,
        column: f.column as number | undefined
      }))
      const topId = this.stack[0]?.id
      if (topId !== undefined) {
        const scopesRes = await client.request<{ scopes?: Array<Record<string, unknown>> }>('scopes', {
          frameId: topId
        })
        const scopes = scopesRes.scopes ?? []
        const localScope =
          scopes.find((s) => /local/i.test((s.name as string) ?? '')) ??
          scopes.find((s) => !(s.expensive as boolean)) ??
          scopes[0]
        if (localScope) {
          const ref = localScope.variablesReference as number
          if (ref) {
            const varsRes = await client.request<{ variables?: Array<Record<string, unknown>> }>(
              'variables',
              { variablesReference: ref }
            )
            this.locals = (varsRes.variables ?? []).slice(0, 50).map((v) => ({
              name: v.name as string,
              value: capValue((v.value as string) ?? ''),
              type: v.type as string | undefined,
              ref: (v.variablesReference as number) || undefined
            }))
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  private hasExceptionFilter(): boolean {
    const filters = this.capabilities.exceptionBreakpointFilters as
      | Array<{ filter?: string }>
      | undefined
    if (!filters) return false
    return filters.some((f) => f.filter === 'uncaught')
  }

  private async configure(): Promise<void> {
    const client = this.client!
    // Set breakpoints per file.
    const byFile = new Map<string, DebugBreakpoint[]>()
    for (const bp of this.breakpoints) {
      const arr = byFile.get(bp.path) ?? []
      arr.push(bp)
      byFile.set(bp.path, arr)
    }
    this.verifiedBps = []
    for (const [path, bps] of Array.from(byFile.entries())) {
      try {
        const res = await client.request<{ breakpoints?: Array<Record<string, unknown>> }>(
          'setBreakpoints',
          {
            source: { path },
            breakpoints: bps.map((b) => ({ line: b.line, condition: b.condition }))
          }
        )
        const verified = res.breakpoints ?? []
        bps.forEach((b, i) => {
          const v = verified[i]
          this.verifiedBps.push({
            path,
            line: (v?.line as number) ?? b.line,
            verified: Boolean(v?.verified),
            message: v?.message as string | undefined
          })
        })
      } catch (err) {
        for (const b of bps) {
          this.verifiedBps.push({
            path,
            line: b.line,
            verified: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }
    }
    const filters = this.hasExceptionFilter() ? ['uncaught'] : []
    try {
      await client.request('setExceptionBreakpoints', { filters })
    } catch {
      // some adapters reject unknown filters; ignore.
    }
    try {
      await client.request('configurationDone')
    } catch {
      // optional for some adapters
    }
  }

  async start(): Promise<DebugState> {
    const client = await this.setupTransport()
    this.client = client
    this.wireEvents(client)

    const initRes = await client.request<Record<string, unknown>>('initialize', {
      clientID: 'pawn',
      clientName: 'Pawn',
      adapterID: this.adapter.adapterID,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsRunInTerminalRequest: false
    })
    this.capabilities = initRes ?? {}

    // Register the 'initialized' handler BEFORE launch: many adapters only
    // answer the launch request after configurationDone completes.
    const initializedPromise = new Promise<void>((resolve) => {
      client.once('event:initialized', () => {
        this.initializedResolved = true
        void this.configure().finally(resolve)
      })
    })

    const launchArgs = buildLaunchArgs(this.language, this.opts)
    const launchPromise = client.request('launch', launchArgs).catch(() => {
      // launch may resolve only after configurationDone; ignore rejection here.
    })

    // Wait for configuration to complete (driven by the 'initialized' event).
    await Promise.race([
      initializedPromise,
      new Promise<void>((r) => setTimeout(r, this.opts.timeoutMs ?? 15000).unref?.())
    ])

    // Wait for the first stop/terminate, or fall back to 'running'.
    const wait = this.waitForEvent(2000)
    await Promise.race([wait, launchPromise])
    await wait

    if (this.status === 'starting') this.status = 'running'
    return this.state()
  }

  async setBreakpoints(
    path: string,
    bps: Array<{ line: number; condition?: string }>
  ): Promise<DebugState> {
    this.breakpoints = this.breakpoints.filter((b) => b.path !== path)
    for (const b of bps) this.breakpoints.push({ path, line: b.line, condition: b.condition })
    const client = this.client
    if (client) {
      try {
        const res = await client.request<{ breakpoints?: Array<Record<string, unknown>> }>(
          'setBreakpoints',
          {
            source: { path },
            breakpoints: bps.map((b) => ({ line: b.line, condition: b.condition }))
          }
        )
        const verified = res.breakpoints ?? []
        this.verifiedBps = this.verifiedBps.filter((v) => v.path !== path)
        bps.forEach((b, i) => {
          const v = verified[i]
          this.verifiedBps.push({
            path,
            line: (v?.line as number) ?? b.line,
            verified: Boolean(v?.verified),
            message: v?.message as string | undefined
          })
        })
      } catch (err) {
        throw new Error(`setBreakpoints failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return this.state()
  }

  private clearStopState(): void {
    this.stopReason = undefined
    this.stopDescription = undefined
    this.stack = []
    this.locals = []
  }

  async continue(timeoutMs: number): Promise<DebugState> {
    if (this.status === 'terminated') return this.state()
    const client = this.client!
    const wait = this.waitForEvent(timeoutMs)
    this.clearStopState()
    this.status = 'running'
    try {
      await client.request('continue', { threadId: this.threadId ?? 1 })
    } catch {
      // ignore
    }
    await wait
    return this.state()
  }

  async step(kind: 'over' | 'into' | 'out', timeoutMs: number): Promise<DebugState> {
    if (this.status === 'terminated') return this.state()
    const client = this.client!
    const command = kind === 'over' ? 'next' : kind === 'into' ? 'stepIn' : 'stepOut'
    const wait = this.waitForEvent(timeoutMs)
    this.clearStopState()
    this.status = 'running'
    try {
      await client.request(command, { threadId: this.threadId ?? 1 })
    } catch {
      // ignore
    }
    await wait
    return this.state()
  }

  async pause(): Promise<DebugState> {
    if (this.status === 'terminated') return this.state()
    const client = this.client!
    const wait = this.waitForEvent(5000)
    try {
      await client.request('pause', { threadId: this.threadId ?? 1 })
    } catch {
      // ignore
    }
    await wait
    return this.state()
  }

  private drainOutput(cap = 4000): string {
    let out = this.outputBuffer
    this.outputBuffer = ''
    if (out.length > cap) out = out.slice(out.length - cap)
    return out
  }

  state(): DebugState {
    const top = this.stack[0]
    const st: DebugState = {
      sessionKey: this.key,
      language: this.language,
      status: this.status,
      output: this.drainOutput(),
      breakpoints: this.verifiedBps
    }
    if (this.status === 'stopped') {
      st.reason = this.stopReason
      st.description = this.stopDescription
      st.threadId = this.threadId
      if (top) {
        st.location = { path: top.path, line: top.line, column: top.column, function: top.name }
        st.source = buildSourceSnippet(top.path, top.line)
      }
      st.stack = this.stack.slice(0, 20)
      st.locals = this.locals.slice(0, 50)
      if (this.exceptionText) st.exception = this.exceptionText
    }
    if (this.status === 'terminated') st.exitCode = this.exitCode
    return st
  }

  async evaluate(
    expression: string,
    frameId?: number
  ): Promise<{ result: string; type?: string; error?: string }> {
    const client = this.client
    if (!client) return { result: '', error: 'no active debug client' }
    const fid = frameId ?? this.stack[0]?.id
    try {
      const res = await client.request<{ result?: string; type?: string; variablesReference?: number }>(
        'evaluate',
        { expression, frameId: fid, context: 'repl' }
      )
      return { result: res.result ?? '', type: res.type }
    } catch (err) {
      return { result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }

  async stop(): Promise<void> {
    const client = this.client
    if (client) {
      try {
        await client.request('disconnect', { terminateDebuggee: true }, 2000)
      } catch {
        // ignore
      }
      client.dispose()
    }
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {
        // ignore
      }
    }
    const child = this.child
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
    this.status = 'terminated'
  }
}

// --------------------------------------------------------------------------
// Manager
// --------------------------------------------------------------------------

export class DebugManager {
  private readonly sessions = new Map<string, DebugSession>()

  async start(opts: DebugStartOptions): Promise<DebugState> {
    if (!opts.sessionKey) throw new Error('start: sessionKey is required')
    if (!opts.program) throw new Error('start: program is required')
    if (!opts.cwd) throw new Error('start: cwd is required')

    // Replace any existing session for this key.
    const existing = this.sessions.get(opts.sessionKey)
    if (existing) {
      await existing.stop().catch(() => {})
      this.sessions.delete(opts.sessionKey)
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(
        `Too many debug sessions (max ${MAX_SESSIONS}). Stop one with debug_stop before starting another.`
      )
    }

    const language = resolveLanguage(opts)
    let session: DebugSession
    if (language === 'node') {
      session = new NodeSession(opts)
    } else {
      const adapter = resolveDapAdapter(language, opts)
      session = new DapSession(language, opts, adapter)
    }
    this.sessions.set(opts.sessionKey, session)
    try {
      return await session.start()
    } catch (err) {
      await session.stop().catch(() => {})
      this.sessions.delete(opts.sessionKey)
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  private require(key: string): DebugSession {
    const s = this.sessions.get(key)
    if (!s) throw new Error(`No debug session "${key}". Start one with debug_start.`)
    return s
  }

  async setBreakpoints(
    key: string,
    path: string,
    breakpoints: Array<{ line: number; condition?: string }>
  ): Promise<DebugState> {
    return this.require(key).setBreakpoints(path, breakpoints)
  }

  async continue(key: string, timeoutMs = DEFAULT_RUN_TIMEOUT): Promise<DebugState> {
    return this.require(key).continue(timeoutMs)
  }

  async step(
    key: string,
    kind: 'over' | 'into' | 'out',
    timeoutMs = DEFAULT_RUN_TIMEOUT
  ): Promise<DebugState> {
    return this.require(key).step(kind, timeoutMs)
  }

  async pause(key: string): Promise<DebugState> {
    return this.require(key).pause()
  }

  state(key: string): DebugState {
    return this.require(key).state()
  }

  async evaluate(
    key: string,
    expression: string,
    frameId?: number
  ): Promise<{ result: string; type?: string; error?: string }> {
    return this.require(key).evaluate(expression, frameId)
  }

  async stop(key: string): Promise<void> {
    const s = this.sessions.get(key)
    if (!s) throw new Error(`No debug session "${key}". Start one with debug_start.`)
    await s.stop().catch(() => {})
    this.sessions.delete(key)
  }

  async stopAll(): Promise<void> {
    const entries = Array.from(this.sessions.values())
    this.sessions.clear()
    await Promise.all(entries.map((s) => s.stop().catch(() => {})))
  }

  list(): Array<{ sessionKey: string; language: DebugLanguage; status: DebugState['status'] }> {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionKey: s.key,
      language: s.language,
      status: s.state().status
    }))
  }
}

// --------------------------------------------------------------------------
// formatDebugState
// --------------------------------------------------------------------------

export function formatDebugState(state: DebugState): string {
  const lines: string[] = []
  let statusLine = `[${state.language}] session "${state.sessionKey}": ${state.status}`
  if (state.reason) statusLine += ` (${state.reason})`
  if (state.status === 'terminated' && state.exitCode !== undefined) {
    statusLine += ` — exit code ${state.exitCode}`
  }
  lines.push(statusLine)

  if (state.location) {
    const loc = state.location
    const fn = loc.function ? ` in ${loc.function}` : ''
    lines.push(`at ${loc.path ?? '<unknown>'}:${loc.line}${loc.column ? ':' + loc.column : ''}${fn}`)
  }

  if (state.source) {
    lines.push('')
    lines.push(state.source)
  }

  if (state.exception) {
    lines.push('')
    lines.push(`Exception: ${state.exception}`)
  }

  if (state.locals && state.locals.length) {
    lines.push('')
    lines.push('Locals:')
    for (const v of state.locals) {
      lines.push(`  ${v.name} = ${v.value}${v.type ? ` (${v.type})` : ''}`)
    }
  }

  if (state.stack && state.stack.length) {
    lines.push('')
    lines.push('Stack (top 8):')
    for (const f of state.stack.slice(0, 8)) {
      const where = f.path ? ` ${f.path}:${f.line}` : ` :${f.line}`
      lines.push(`  #${f.id} ${f.name}${where}`)
    }
  }

  if (state.output && state.output.trim()) {
    lines.push('')
    lines.push('Output:')
    lines.push(state.output.replace(/\n$/, ''))
  }

  if (state.breakpoints && state.breakpoints.length) {
    lines.push('')
    const summary = state.breakpoints
      .map((b) => `${b.path}:${b.line}${b.verified ? '' : ' (unverified)'}`)
      .join(', ')
    lines.push(`Breakpoints: ${summary}`)
  }

  return lines.join('\n')
}

// --------------------------------------------------------------------------
// Shared instance
// --------------------------------------------------------------------------

let shared: DebugManager | null = null

export function getDebugManager(): DebugManager {
  if (!shared) shared = new DebugManager()
  return shared
}
