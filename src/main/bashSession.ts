/**
 * Persistent bash session for the Pawn desktop agent.
 *
 * Backs Anthropic's `bash_20250124` tool: Claude sends either { command } or
 * { restart: true }, and we keep ONE long-lived `/bin/bash` process per chat
 * session so that cwd, exported variables, shell functions and aliases persist
 * between commands.
 *
 * Design highlights:
 *  - `/bin/bash --noprofile --norc`, `detached: true` (own process group so a
 *    timeout can kill the whole process tree), stdio pipes.
 *  - `exec 2>&1` sent right after spawn so stderr interleaves with stdout in
 *    the order it is produced.
 *  - Each command is written to a private temp file (mode 0600) and *sourced*
 *    (`. file`) so state survives and any syntax (heredocs, unbalanced quotes)
 *    is tolerated as a shell error rather than a hung shell. The command reads
 *    from /dev/null so it cannot eat the protocol stream.
 *  - A per-command random sentinel line carries the exit code and PWD back.
 *  - Commands are serialized per session via an internal queue.
 *
 * Pure Node: no electron imports (also used by a headless Node runner).
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import {
  sanitizeEnv,
  checkDangerousCommand,
  jailCwd,
  macNetworkOffProfile,
  type SandboxOptions
} from './shellSandbox'
import { buildRemoteShellArgs, resolveHost, type SshHost } from './ssh'

export interface BashRunOptions {
  /** Per-command wall-clock timeout. Default 120000ms, clamped to 1000..600000. */
  timeoutMs?: number
  sandbox?: SandboxOptions
  signal?: AbortSignal
}

export interface BashRunResult {
  output: string
  exitCode: number | null
  cwd: string
  timedOut: boolean
  restarted: boolean
  blocked?: boolean
  truncated?: boolean
  note?: string
}

function realpathOr(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

const DEFAULT_TIMEOUT = 120_000
const MIN_TIMEOUT = 1_000
const MAX_TIMEOUT = 600_000
const MAX_BUFFER = 4 * 1024 * 1024 // 4 MB
const HEAD_KEEP = 1 * 1024 * 1024 // 1 MB
const KILL_ESCALATE_MS = 1_000

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TIMEOUT
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.floor(ms)))
}

/** Single-quote a string safely for POSIX shells. */
function shQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

interface PendingCommand {
  command: string
  opts: BashRunOptions
  resolve: (r: BashRunResult) => void
  reject: (e: unknown) => void
}

export class BashSession {
  private readonly initialCwd: string
  private readonly sandbox: SandboxOptions | undefined
  private readonly shellPath: string
  private proc: ChildProcessWithoutNullStreams | null = null
  private _cwd: string
  private _alive = false
  private disposed = false

  // Command queue (serialized execution).
  private queue: PendingCommand[] = []
  private running = false

  // Per-command state (only valid while a command is in flight).
  private buf: Buffer[] = []
  private bufLen = 0
  private truncated = false
  private droppedTail = 0
  private pending: Buffer = Buffer.alloc(0) // unflushed trailing bytes (possible partial sentinel)
  private lastExitCode: number | null = null // exit code of the bash process itself (on unexpected exit)
  private currentNonce = '' // hex sentinel token for the in-flight command
  private onData: ((chunk: Buffer) => void) | null = null
  private settleCurrent: ((exitedUnexpectedly: boolean) => void) | null = null

  /** Non-null when this session's bash runs on a remote host over ssh. */
  private remoteHost: SshHost | null = null

  constructor(opts: { cwd: string; sandbox?: SandboxOptions; shell?: string }) {
    this.initialCwd = opts.cwd
    this._cwd = opts.cwd
    this.sandbox = opts.sandbox
    this.shellPath = opts.shell || '/bin/bash'
  }

  get alive(): boolean {
    return this._alive && this.proc != null
  }

  get cwd(): string {
    return this._cwd
  }

  /** Spawn (or respawn) the underlying bash process. */
  private spawnProc(): void {
    const sandboxEnabled = this.sandbox?.enabled !== false
    const networkOff = this.sandbox?.network === false

    const extraEnv: Record<string, string> = {
      TERM: 'dumb',
      PAGER: 'cat',
      GIT_PAGER: 'cat',
      NO_COLOR: '1',
      PS1: ''
    }

    const baseEnv: Record<string, string> = sandboxEnabled
      ? sanitizeEnv(process.env)
      : ({ ...process.env } as Record<string, string>)
    const env: Record<string, string> = { ...baseEnv, ...extraEnv }

    const bashArgs = ['--noprofile', '--norc']

    let file: string
    let args: string[]
    let spawnEnv: Record<string, string> = env
    let spawnCwd: string | undefined = this.initialCwd
    const host: SshHost | null = this.sandbox?.hostId ? resolveHost(this.sandbox.hostId) : null
    this.remoteHost = host
    if (host) {
      // Remote session: a local ssh process whose channel carries the remote
      // bash. The sentinel protocol below is shell-agnostic, so it works over
      // the wire unchanged; killing the local process tears the channel down.
      const plan = buildRemoteShellArgs(host, this.initialCwd)
      file = plan.file
      args = plan.args
      if (plan.env) spawnEnv = { ...spawnEnv, ...plan.env }
      spawnCwd = undefined
    } else if (sandboxEnabled && networkOff && process.platform === 'darwin') {
      file = '/usr/bin/sandbox-exec'
      args = ['-p', macNetworkOffProfile(), this.shellPath, ...bashArgs]
    } else {
      file = this.shellPath
      args = bashArgs
    }

    const proc = spawn(file, args, {
      cwd: spawnCwd,
      env: spawnEnv,
      detached: true, // own process group => can kill the whole tree
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams

    this.proc = proc
    this._alive = true
    this._cwd = this.initialCwd

    proc.stdout.on('data', (chunk: Buffer) => {
      if (this.proc === proc && this.onData) this.onData(chunk)
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      // exec 2>&1 should route stderr to stdout, but keep a safety net for
      // anything emitted before that runs.
      if (this.proc === proc && this.onData) this.onData(chunk)
    })

    proc.on('exit', (code, signal) => {
      // Ignore exit events from a process we already replaced (e.g. after a
      // timeout/abort respawn); only the current proc's death matters.
      if (this.proc !== proc) return
      this._alive = false
      this.lastExitCode = typeof code === 'number' ? code : signal ? null : null
      // If a command is still in flight, settle it as an unexpected exit.
      if (this.settleCurrent) this.settleCurrent(true)
    })
    proc.on('error', () => {
      if (this.proc !== proc) return
      this._alive = false
      if (this.settleCurrent) this.settleCurrent(true)
    })

    // Interleave stderr into stdout in order and quiet job-control chatter.
    try {
      proc.stdin.write('exec 2>&1\n')
      proc.stdin.write('set +m 2>/dev/null || true\n')
    } catch {
      // ignore write errors; the exit/error handlers will surface the failure
    }
  }

  private ensureAlive(): void {
    if (!this.alive) {
      this.spawnProc()
    }
  }

  private appendBuf(chunk: Buffer): void {
    if (this.truncated) {
      // Already over cap: keep counting how much of the tail we dropped so the
      // marker can report an approximate omitted count.
      this.droppedTail += chunk.length
      return
    }
    if (this.bufLen + chunk.length > MAX_BUFFER) {
      this.truncated = true
      const room = MAX_BUFFER - this.bufLen
      if (room > 0) {
        this.buf.push(chunk.subarray(0, room))
        this.bufLen += room
        this.droppedTail += chunk.length - room
      } else {
        this.droppedTail += chunk.length
      }
      return
    }
    this.buf.push(chunk)
    this.bufLen += chunk.length
  }

  /** Assemble the captured output, applying head/tail truncation if needed. */
  private takeOutput(): { text: string; truncated: boolean } {
    const full = Buffer.concat(this.buf, this.bufLen).toString('utf8')
    if (!this.truncated) return { text: full, truncated: false }
    // Keep head 1MB + tail; the middle is dropped.
    const head = full.slice(0, HEAD_KEEP)
    const tailBudget = Math.max(0, HEAD_KEEP) // keep a comparable tail slice
    const tail = full.slice(Math.max(head.length, full.length - tailBudget))
    const omitted = full.length - head.length - tail.length + this.droppedTail
    const marker = `\n...(${omitted} chars omitted)...\n`
    return { text: head + marker + tail, truncated: true }
  }

  private resetCommandState(): void {
    this.buf = []
    this.bufLen = 0
    this.truncated = false
    this.droppedTail = 0
    this.pending = Buffer.alloc(0)
    this.currentNonce = ''
    this.onData = null
    this.settleCurrent = null
  }

  /** Move any buffered-but-unflushed trailing bytes into the capped buffer. */
  private flushPending(): void {
    if (this.pending.length > 0) {
      this.appendBuf(this.pending)
      this.pending = Buffer.alloc(0)
    }
  }

  /**
   * Public API: run one command, serialized behind any queued commands.
   */
  run(command: string, opts: BashRunOptions = {}): Promise<BashRunResult> {
    if (process.platform === 'win32') {
      return Promise.resolve<BashRunResult>({
        output:
          'Error: the persistent bash session is not supported on Windows; use the shell_exec tool instead.',
        exitCode: null,
        cwd: this._cwd,
        timedOut: false,
        restarted: false,
        blocked: true
      })
    }
    if (this.disposed) {
      return Promise.resolve<BashRunResult>({
        output: 'Error: bash session has been disposed.',
        exitCode: null,
        cwd: this._cwd,
        timedOut: false,
        restarted: false,
        blocked: true
      })
    }
    return new Promise<BashRunResult>((resolve, reject) => {
      this.queue.push({ command, opts, resolve, reject })
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift() as PendingCommand
        try {
          const result = await this.execOne(item.command, item.opts)
          item.resolve(result)
        } catch (e) {
          item.reject(e)
        }
      }
    } finally {
      this.running = false
    }
  }

  private async execOne(command: string, opts: BashRunOptions): Promise<BashRunResult> {
    const sandboxEnabled = opts.sandbox?.enabled !== false && this.sandbox?.enabled !== false
    const effectiveSandbox: SandboxOptions | undefined = opts.sandbox ?? this.sandbox

    // Dangerous-command gate.
    if (sandboxEnabled) {
      const danger = checkDangerousCommand(command)
      if (danger) {
        return {
          output: danger,
          exitCode: 126,
          cwd: this._cwd,
          timedOut: false,
          restarted: false,
          blocked: true
        }
      }
    }

    // Validate initial cwd against the jail before we ever spawn.
    const wantJail =
      sandboxEnabled &&
      effectiveSandbox?.jailCwd !== false &&
      Boolean(effectiveSandbox?.projectRoot)
    if (wantJail) {
      const j = jailCwd(this.initialCwd, effectiveSandbox?.projectRoot)
      if (!j.ok) {
        return {
          output: j.error,
          exitCode: 126,
          cwd: this._cwd,
          timedOut: false,
          restarted: false,
          blocked: true
        }
      }
    }

    this.ensureAlive()
    const proc = this.proc
    if (!proc || !this._alive) {
      return {
        output: 'Error: failed to start bash session.',
        exitCode: null,
        cwd: this._cwd,
        timedOut: false,
        restarted: false,
        blocked: true
      }
    }

    const timeoutMs = clampTimeout(opts.timeoutMs)
    const nonce = randomBytes(8).toString('hex')
    const sentinelPrefix = `__PAWN_DONE_${nonce}_`

    // Write the command body to a private temp file (mode 0600).
    const dir = mkdtempSync(join(tmpdir(), 'pawn-bash-'))
    const cmdFile = join(dir, 'cmd.sh')
    writeFileSync(cmdFile, command + '\n', { mode: 0o600 })

    this.resetCommandState()
    this.currentNonce = nonce
    this.lastExitCode = null

    return await new Promise<BashRunResult>((resolve) => {
      let finished = false
      let timer: NodeJS.Timeout | null = null

      const cleanupFile = (): void => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // temp cleanup best-effort
        }
      }

      const finish = (r: BashRunResult): void => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
        this.onData = null
        this.settleCurrent = null
        cleanupFile()
        resolve(r)
      }

      // Handle bash dying mid-command (e.g. the command ran `exit`).
      this.settleCurrent = (exitedUnexpectedly: boolean): void => {
        if (!exitedUnexpectedly || finished) return
        this.flushPending()
        const { text, truncated } = this.takeOutput()
        // Try to salvage an exit code from a full sentinel if one slipped in;
        // otherwise fall back to the bash process's own exit code.
        const parsed = extractSentinel(text, sentinelPrefix)
        const exitCode = parsed ? parsed.code : this.lastExitCode
        const respawnCwd = this.initialCwd
        this.proc = null
        this._alive = false
        this.spawnProc() // auto-respawn for the next command
        finish({
          output: parsed ? parsed.body : text,
          exitCode,
          cwd: respawnCwd,
          timedOut: false,
          restarted: true,
          truncated: truncated || undefined,
          note: 'bash exited; a new session was started'
        })
      }

      this.onData = (chunk: Buffer): void => {
        // Accumulate for the raw buffer (with cap) and also scan for sentinel.
        this.pending = Buffer.concat([this.pending, chunk])
        const asStr = this.pending.toString('utf8')
        const idx = asStr.indexOf(sentinelPrefix)
        if (idx === -1) {
          // No sentinel yet. Flush all but a small tail (in case the sentinel
          // is split across chunks) into the capped buffer.
          const keep = sentinelPrefix.length + 64
          if (this.pending.length > keep) {
            const flush = this.pending.subarray(0, this.pending.length - keep)
            this.appendBuf(flush)
            this.pending = this.pending.subarray(this.pending.length - keep)
          }
          return
        }
        // Found the sentinel start. The line may be incomplete; wait for EOL.
        const afterIdx = asStr.indexOf('\n', idx)
        if (afterIdx === -1) return // sentinel line not terminated yet
        // Everything before the sentinel start is real output.
        const beforeBytes = Buffer.byteLength(asStr.slice(0, idx), 'utf8')
        if (beforeBytes > 0) {
          this.appendBuf(this.pending.subarray(0, beforeBytes))
        }
        this.pending = Buffer.alloc(0)
        const sentinelLine = asStr.slice(idx, afterIdx)
        const rest = sentinelLine.slice(sentinelPrefix.length)
        // Format: <exitcode>_<pwd>
        const us = rest.indexOf('_')
        let code: number | null = null
        let pwd = this._cwd
        if (us !== -1) {
          const codeStr = rest.slice(0, us)
          pwd = rest.slice(us + 1)
          const n = parseInt(codeStr, 10)
          code = Number.isFinite(n) ? n : null
        }

        // Assemble output; strip the single leading newline artifact from the
        // `printf '\n...'` and the fact we source after a prompt.
        let out = this.takeOutput().text
        const truncated = this.truncated
        if (out.startsWith('\n')) out = out.slice(1)
        // Remove a possible trailing newline that precedes the sentinel.
        if (out.endsWith('\n')) out = out.slice(0, -1)

        this._cwd = pwd || this._cwd

        // cwd jail enforcement on the resulting PWD.
        let note: string | undefined
        if (wantJail && effectiveSandbox?.projectRoot) {
          // Compare physical paths: bash reports getcwd() (/private/var/…)
          // while the root may be a symlinked path (/var/…, /tmp/…).
          const j = jailCwd(realpathOr(pwd), realpathOr(effectiveSandbox.projectRoot))
          if (!j.ok) {
            const root = effectiveSandbox.projectRoot
            try {
              proc.stdin.write(`cd ${shQuote(root)}\n`)
            } catch {
              // ignore
            }
            this._cwd = root
            note = `cwd left the project root; reset to ${root}`
          }
        }

        finish({
          output: out,
          exitCode: code,
          cwd: this._cwd,
          timedOut: false,
          restarted: false,
          truncated: truncated || undefined,
          note
        })
      }

      const killGroupAndRespawn = (reason: 'timeout' | 'abort'): void => {
        this.flushPending()
        const { text } = this.takeOutput()
        let partial = text
        if (partial.startsWith('\n')) partial = partial.slice(1)
        const secs = Math.round(timeoutMs / 1000)
        const msg =
          reason === 'timeout'
            ? `Error: command did not finish within ${secs}s; the bash session was restarted (cwd, env and background jobs were reset).`
            : `Error: command was aborted; the bash session was restarted (cwd, env and background jobs were reset).`
        const combined = partial.length > 0 ? partial + '\n' + msg : msg
        this.hardKill()
        this.spawnProc()
        finish({
          output: combined,
          exitCode: null,
          cwd: this.initialCwd,
          timedOut: reason === 'timeout',
          restarted: true,
          note: reason === 'abort' ? 'aborted' : undefined
        })
      }

      const onAbort = (): void => {
        killGroupAndRespawn('abort')
      }

      if (opts.signal) {
        if (opts.signal.aborted) {
          // Abort before we even started.
          killGroupAndRespawn('abort')
          return
        }
        opts.signal.addEventListener('abort', onAbort, { once: true })
      }

      timer = setTimeout(() => {
        killGroupAndRespawn('timeout')
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()

      // Send the protocol line. Sourcing keeps state; </dev/null keeps the
      // command from consuming our stdin protocol stream.
      // Remote sessions cannot source a LOCAL temp file (the path does not
      // exist on the remote host), so the command ships base64-encoded over
      // the wire and is decoded + eval'd in the remote shell — eval keeps the
      // same shell context, so exports and $PWD tracking behave identically.
      const b64 = Buffer.from(command, 'utf8').toString('base64')
      const body = this.remoteHost
        ? `eval "$(printf %s ${shQuote(b64)} | base64 -d)" < /dev/null`
        : `. ${shQuote(cmdFile)} < /dev/null`
      const line =
        `${body}; __pawn_ec=$?;${this.remoteHost ? '' : ` rm -f ${shQuote(cmdFile)};`} ` +
        `printf '\\n${sentinelPrefix}%s_%s\\n' "$__pawn_ec" "$PWD"\n`
      try {
        proc.stdin.write(line)
      } catch (e) {
        finish({
          output: 'Error: failed to write to bash session: ' + String(e),
          exitCode: null,
          cwd: this._cwd,
          timedOut: false,
          restarted: false,
          blocked: true
        })
      }
    })
  }

  /** Kill the whole process group (SIGTERM then SIGKILL). */
  private hardKill(): void {
    const proc = this.proc
    this.proc = null
    this._alive = false
    if (!proc || proc.pid == null) return
    const pid = proc.pid
    try {
      // Negative pid => the process group (detached spawn gave us our own).
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        proc.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
    const t = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          proc.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
    }, KILL_ESCALATE_MS)
    if (typeof t.unref === 'function') t.unref()
  }

  /** Restart: kill the current process group and spawn a fresh session. */
  async restart(): Promise<void> {
    this.hardKill()
    // Small delay so the OS reaps the group before we start again.
    await new Promise<void>((r) => {
      const t = setTimeout(r, 30)
      if (typeof t.unref === 'function') t.unref()
    })
    this.spawnProc()
  }

  /** Terminate a currently-running command's process group immediately. */
  kill(): void {
    this.hardKill()
  }

  dispose(): void {
    this.disposed = true
    this.hardKill()
    // Reject anything still queued.
    const pending = this.queue.splice(0, this.queue.length)
    for (const p of pending) {
      p.resolve({
        output: 'Error: bash session disposed before command ran.',
        exitCode: null,
        cwd: this._cwd,
        timedOut: false,
        restarted: false,
        blocked: true
      })
    }
  }
}

/** Extract a full sentinel line's body/code from captured text (best-effort). */
function extractSentinel(
  text: string,
  sentinelPrefix: string
): { body: string; code: number | null } | null {
  const idx = text.indexOf(sentinelPrefix)
  if (idx === -1) return null
  const afterIdx = text.indexOf('\n', idx)
  const end = afterIdx === -1 ? text.length : afterIdx
  const line = text.slice(idx, end)
  const rest = line.slice(sentinelPrefix.length)
  const us = rest.indexOf('_')
  let code: number | null = null
  if (us !== -1) {
    const n = parseInt(rest.slice(0, us), 10)
    code = Number.isFinite(n) ? n : null
  }
  let body = text.slice(0, idx)
  if (body.startsWith('\n')) body = body.slice(1)
  if (body.endsWith('\n')) body = body.slice(0, -1)
  return { body, code }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const IDLE_DISPOSE_MS = 30 * 60 * 1000 // 30 min
const MAX_SESSIONS = 12

interface SessionEntry {
  session: BashSession
  cwd: string
  sandbox: SandboxOptions | undefined
  busy: boolean
  lastUsed: number
}

export class BashSessionManager {
  private sessions = new Map<string, SessionEntry>()
  private idleTimer: NodeJS.Timeout | null = null

  private ensureIdleSweeper(): void {
    if (this.idleTimer) return
    const t = setInterval(() => this.sweepIdle(), 60 * 1000)
    if (typeof t.unref === 'function') t.unref()
    this.idleTimer = t
  }

  private sweepIdle(): void {
    const now = Date.now()
    for (const [key, entry] of Array.from(this.sessions.entries())) {
      if (!entry.busy && now - entry.lastUsed > IDLE_DISPOSE_MS) {
        entry.session.dispose()
        this.sessions.delete(key)
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < MAX_SESSIONS) return
    // Evict the least-recently-used idle session.
    let victimKey: string | null = null
    let oldest = Infinity
    for (const [key, entry] of Array.from(this.sessions.entries())) {
      if (!entry.busy && entry.lastUsed < oldest) {
        oldest = entry.lastUsed
        victimKey = key
      }
    }
    if (victimKey != null) {
      const victim = this.sessions.get(victimKey)
      if (victim) victim.session.dispose()
      this.sessions.delete(victimKey)
    }
  }

  private getOrCreate(key: string, cwd: string, sandbox: SandboxOptions | undefined): SessionEntry {
    this.ensureIdleSweeper()
    let entry = this.sessions.get(key)
    if (!entry) {
      this.evictIfNeeded()
      const session = new BashSession({ cwd, sandbox })
      entry = { session, cwd, sandbox, busy: false, lastUsed: Date.now() }
      this.sessions.set(key, entry)
    }
    return entry
  }

  async run(
    key: string,
    command: string,
    opts: BashRunOptions & { cwd: string }
  ): Promise<BashRunResult> {
    const entry = this.getOrCreate(key, opts.cwd, opts.sandbox)
    entry.busy = true
    entry.lastUsed = Date.now()
    try {
      const result = await entry.session.run(command, {
        timeoutMs: opts.timeoutMs,
        sandbox: opts.sandbox ?? entry.sandbox,
        signal: opts.signal
      })
      entry.cwd = result.cwd
      return result
    } finally {
      entry.busy = false
      entry.lastUsed = Date.now()
    }
  }

  async restart(key: string, cwd: string, sandbox?: SandboxOptions): Promise<BashRunResult> {
    // Re-create the session with the given cwd/sandbox.
    const existing = this.sessions.get(key)
    if (existing) {
      existing.session.dispose()
      this.sessions.delete(key)
    }
    const entry = this.getOrCreate(key, cwd, sandbox)
    entry.lastUsed = Date.now()
    return {
      output: '',
      exitCode: 0,
      cwd,
      timedOut: false,
      restarted: true,
      note: 'bash session restarted'
    }
  }

  kill(key: string): boolean {
    const entry = this.sessions.get(key)
    if (!entry) return false
    entry.session.kill()
    entry.session.dispose()
    this.sessions.delete(key)
    return true
  }

  killAll(): number {
    let n = 0
    for (const [key, entry] of Array.from(this.sessions.entries())) {
      entry.session.dispose()
      this.sessions.delete(key)
      n++
    }
    return n
  }

  list(): Array<{ key: string; cwd: string; busy: boolean; idleMs: number }> {
    const now = Date.now()
    const out: Array<{ key: string; cwd: string; busy: boolean; idleMs: number }> = []
    for (const [key, entry] of Array.from(this.sessions.entries())) {
      out.push({
        key,
        cwd: entry.session.cwd || entry.cwd,
        busy: entry.busy,
        idleMs: entry.busy ? 0 : now - entry.lastUsed
      })
    }
    return out
  }
}

let singleton: BashSessionManager | null = null

export function getBashSessionManager(): BashSessionManager {
  if (!singleton) singleton = new BashSessionManager()
  return singleton
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatBashResult(r: BashRunResult, maxChars = 30_000): string {
  let body = r.output ?? ''
  if (body.length > maxChars) {
    const head = Math.floor(maxChars * 0.6)
    const tail = maxChars - head
    const omitted = body.length - head - tail
    body = body.slice(0, head) + `\n...(${omitted} chars omitted)...\n` + body.slice(body.length - tail)
  }

  const footer: string[] = []
  if (r.blocked) {
    footer.push('[blocked by sandbox policy]')
  }
  if (r.timedOut) {
    footer.push('[timed out; bash session was restarted]')
  } else if (r.restarted) {
    footer.push('[bash session was restarted]')
  }
  if (r.note && !r.timedOut) {
    footer.push(`[${r.note}]`)
  }
  if (typeof r.exitCode === 'number' && r.exitCode !== 0) {
    footer.push(`[exit code: ${r.exitCode}]`)
  }
  if (r.truncated) {
    footer.push('[output truncated]')
  }

  const hasBody = body.trim().length > 0
  if (!hasBody && r.exitCode === 0 && footer.length === 0) {
    return '(no output)'
  }

  const parts: string[] = []
  if (hasBody) parts.push(body)
  else if (footer.length === 0) parts.push('(no output)')
  if (footer.length > 0) parts.push(footer.join(' '))
  return parts.join('\n')
}
