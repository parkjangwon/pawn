import { handleTrusted } from './trust'
import { spawn, type ChildProcess } from 'child_process'
import { planExecFile, planShellSpawn, type SandboxOptions } from '../shellSandbox'

/** Agent-controlled timeout: 5s..5min, default 30s. */
function clampTimeout(timeoutMs: unknown): number {
  return Number.isFinite(Number(timeoutMs))
    ? Math.min(300_000, Math.max(5_000, Math.floor(Number(timeoutMs))))
    : 30_000
}

interface ExecError {
  stdout?: string
  stderr?: string
  code?: number
  killed?: boolean
  signal?: string
}

function errorPayload(err: unknown): { stdout: string; stderr: string; exitCode: number; killed?: boolean } {
  const e = err as ExecError
  return {
    stdout: e.stdout || '',
    stderr: e.stderr || '',
    exitCode: typeof e.code === 'number' ? e.code : 1,
    killed: e.killed === true || e.signal === 'SIGTERM' || e.signal === 'SIGKILL'
  }
}

const liveChildren = new Set<ChildProcess>()

interface BgJob {
  id: string
  command: string
  child: ChildProcess
  stdout: string
  stderr: string
  exitCode: number | null
  killed: boolean
  startedAt: number
}

const backgroundJobs = new Map<string, BgJob>()
let jobSeq = 0
const MAX_JOB_BUFFER = 10 * 1024 * 1024

function killChild(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      if (child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      }
    } else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          /* already dead */
        }
      }
      setTimeout(() => {
        try {
          if (child.pid && !child.killed && child.exitCode === null) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              child.kill('SIGKILL')
            }
          }
        } catch {
          /* ignore */
        }
      }, 1500)
    }
  } catch {
    /* ignore */
  }
}

export function killAllAgentShells(): number {
  let n = 0
  for (const child of Array.from(liveChildren)) {
    killChild(child)
    n++
  }
  liveChildren.clear()
  for (const job of Array.from(backgroundJobs.values())) {
    if (job.exitCode === null) {
      killChild(job.child)
      job.killed = true
      n++
    }
  }
  return n
}

function runSpawned(
  file: string,
  args: string[],
  cwd: string | undefined,
  timeoutMs: number,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = spawn(file, args, {
      cwd: cwd || undefined,
      env: env || process.env,
      detached: !isWin,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    liveChildren.add(child)

    let stdout = ''
    let stderr = ''
    let settled = false
    const maxBuffer = 10 * 1024 * 1024

    const finish = (payload: { stdout: string; stderr: string; exitCode: number; killed?: boolean }): void => {
      if (settled) return
      settled = true
      liveChildren.delete(child)
      clearTimeout(timer)
      resolve(payload)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > maxBuffer) stdout = stdout.slice(stdout.length - maxBuffer)
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > maxBuffer) stderr = stderr.slice(stderr.length - maxBuffer)
    })

    const timer = setTimeout(() => {
      killChild(child)
      finish({
        stdout,
        stderr: (stderr ? stderr + '\n' : '') + `Command timed out after ${timeoutMs}ms`,
        exitCode: 124,
        killed: true
      })
    }, timeoutMs)

    child.on('error', (err) => {
      finish({ stdout, stderr: stderr || String(err), exitCode: 1 })
    })

    child.on('close', (code, signal) => {
      finish({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : 1,
        killed: signal === 'SIGTERM' || signal === 'SIGKILL' || code === null
      })
    })
  })
}

function runShellCommand(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  sandbox: SandboxOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean; sandboxNote?: string }> {
  const planned = planShellSpawn(command, cwd, sandbox)
  if (!planned.ok) {
    return Promise.resolve({
      stdout: '',
      stderr: planned.error,
      exitCode: 126,
      killed: false,
      sandboxNote: 'blocked'
    })
  }
  return runSpawned(
    planned.plan.file,
    planned.plan.args,
    planned.plan.cwd,
    timeoutMs,
    planned.plan.env
  ).then((r) => ({ ...r, sandboxNote: planned.plan.sandboxNote }))
}

function startBackgroundJob(
  command: string,
  cwd: string | undefined,
  sandbox: SandboxOptions = {}
): { jobId: string; pid?: number; error?: string; sandboxNote?: string } {
  pruneBackgroundJobs()
  const running = Array.from(backgroundJobs.values()).filter((j) => j.exitCode === null).length
  if (running >= MAX_BG_JOBS) {
    return { jobId: '', error: `Too many background jobs (max ${MAX_BG_JOBS}). Kill finished ones first.` }
  }
  const planned = planShellSpawn(command, cwd, sandbox)
  if (!planned.ok) {
    return { jobId: '', error: planned.error }
  }
  const isWin = process.platform === 'win32'
  let child: ChildProcess
  try {
    child = spawn(planned.plan.file, planned.plan.args, {
      cwd: planned.plan.cwd || undefined,
      env: planned.plan.env,
      detached: !isWin,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    return { jobId: '', error: err instanceof Error ? err.message : String(err) }
  }
  const id = `job-${++jobSeq}`
  const job: BgJob = {
    id,
    command,
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    killed: false,
    startedAt: Date.now()
  }
  backgroundJobs.set(id, job)
  liveChildren.add(child)

  const trim = (s: string): string => (s.length > MAX_JOB_BUFFER ? s.slice(s.length - MAX_JOB_BUFFER) : s)
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    job.stdout = trim(job.stdout + chunk)
  })
  child.stderr?.on('data', (chunk: string) => {
    job.stderr = trim(job.stderr + chunk)
  })
  child.on('close', (code, signal) => {
    liveChildren.delete(child)
    job.exitCode = typeof code === 'number' ? code : 1
    job.killed = signal === 'SIGTERM' || signal === 'SIGKILL' || code === null
  })
  child.on('error', (err) => {
    liveChildren.delete(child)
    job.exitCode = 1
    job.stderr = (job.stderr ? job.stderr + '\n' : '') + String(err)
  })

  // Cap lifetime of background jobs (30 min)
  setTimeout(() => {
    if (job.exitCode === null) {
      killChild(child)
      job.killed = true
      job.stderr += '\n(background job auto-killed after 30m)'
    }
  }, 30 * 60 * 1000)

  return { jobId: id, pid: child.pid, sandboxNote: planned.plan.sandboxNote }
}

function parseSandboxOpts(raw: unknown): SandboxOptions {
  if (!raw || typeof raw !== 'object') {
    // Default: sandbox ON for agent shells (env allowlist + denylist)
    return { enabled: true, network: true }
  }
  const o = raw as Record<string, unknown>
  return {
    enabled: o.enabled !== false && o.sandbox !== false,
    network: o.network !== false,
    projectRoot: typeof o.projectRoot === 'string' ? o.projectRoot : undefined,
    // Renderer may opt out of cwd jail; default remains on when projectRoot set.
    jailCwd: o.jailCwd !== false && o.jail_cwd !== false
  }
}

const MAX_BG_JOBS = 40
const BG_JOB_TTL_MS = 30 * 60 * 1000

/** Drop finished background jobs so the map cannot grow without bound. */
function pruneBackgroundJobs(): void {
  const now = Date.now()
  for (const [id, job] of Array.from(backgroundJobs.entries())) {
    if (job.exitCode === null) continue
    if (now - job.startedAt > BG_JOB_TTL_MS) {
      backgroundJobs.delete(id)
    }
  }
  // Hard cap: remove oldest finished first
  if (backgroundJobs.size > MAX_BG_JOBS) {
    const finished = Array.from(backgroundJobs.values())
      .filter((j) => j.exitCode !== null)
      .sort((a, b) => a.startedAt - b.startedAt)
    while (backgroundJobs.size > MAX_BG_JOBS && finished.length) {
      const drop = finished.shift()
      if (drop) backgroundJobs.delete(drop.id)
    }
  }
}

export function registerShellIpc(): void {
  handleTrusted(
    'shell:exec',
    async (_, command: string, cwd?: string, timeoutMs?: number, sandboxOpts?: unknown) => {
      if (typeof command !== 'string' || !command.trim()) {
        return { stdout: '', stderr: 'Empty command', exitCode: 1 }
      }
      try {
        return await runShellCommand(
          command,
          typeof cwd === 'string' ? cwd : undefined,
          clampTimeout(timeoutMs),
          parseSandboxOpts(sandboxOpts)
        )
      } catch (err: unknown) {
        return errorPayload(err)
      }
    }
  )

  handleTrusted(
    'shell:execFile',
    async (_event, file: string, args: unknown, cwd?: string, timeoutMs?: number, sandboxOpts?: unknown) => {
      if (typeof file !== 'string' || !file.trim()) return { error: 'Invalid command' }
      const argList = Array.isArray(args)
        ? args.filter((a): a is string => typeof a === 'string')
        : []
      try {
        const planned = planExecFile(
          file,
          argList,
          typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined,
          parseSandboxOpts(sandboxOpts ?? { enabled: true, network: true })
        )
        if (!planned.ok) {
          return { stdout: '', stderr: planned.error, exitCode: 126 }
        }
        return await runSpawned(
          planned.plan.file,
          planned.plan.args,
          planned.plan.cwd,
          clampTimeout(timeoutMs),
          planned.plan.env
        )
      } catch (err: unknown) {
        return errorPayload(err)
      }
    }
  )

  handleTrusted(
    'shell:start',
    async (_, command: string, cwd?: string, sandboxOpts?: unknown) => {
      if (typeof command !== 'string' || !command.trim()) {
        return { error: 'Empty command' }
      }
      try {
        const started = startBackgroundJob(
          command,
          typeof cwd === 'string' ? cwd : undefined,
          parseSandboxOpts(sandboxOpts)
        )
        if (started.error) return { error: started.error }
        return started
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  handleTrusted('shell:poll', async (_, jobId: string) => {
    if (typeof jobId !== 'string' || !jobId) return { error: 'Invalid job id' }
    pruneBackgroundJobs()
    const job = backgroundJobs.get(jobId)
    if (!job) return { error: `Unknown job: ${jobId}` }
    return {
      jobId: job.id,
      command: job.command,
      status: job.exitCode === null ? 'running' : 'exited',
      stdout: job.stdout,
      stderr: job.stderr,
      exitCode: job.exitCode,
      killed: job.killed,
      elapsedMs: Date.now() - job.startedAt
    }
  })

  handleTrusted('shell:kill', async (_, jobId: string) => {
    if (typeof jobId !== 'string' || !jobId) return { error: 'Invalid job id' }
    const job = backgroundJobs.get(jobId)
    if (!job) return { error: `Unknown job: ${jobId}` }
    if (job.exitCode === null) {
      killChild(job.child)
      job.killed = true
    }
    return { ok: true, jobId }
  })

  handleTrusted('shell:killAll', async () => {
    const killed = killAllAgentShells()
    return { ok: true, killed }
  })
}
