import { resolveToolPath } from '../pathUtils'
import { getProjectTarget } from '../executionTarget'
import { useProviderStore } from '../../stores/provider'
import { useStreamingStore } from '../../stores/streaming'
import type { ToolHandler } from './types'
import type { ToolExecContext } from './types'
import { analyzeProcessOutput, formatAnalysis, markJobSeen, watchJob } from '../runtimeWatch'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Same aggregate shape `shell:exec` resolves with. */
type ShellExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  killed?: boolean
  sandboxNote?: string
  host?: string
}

/** How often the live card refreshes while a foreground command runs. */
const LIVE_POLL_MS = 300
/** Tail lines shown in the live tool card. */
const LIVE_TAIL_LINES = 8

function clipLiveTarget(v: string): string {
  const one = v.replace(/\s+/g, ' ').trim()
  return one.length > 160 ? `${one.slice(0, 159)}…` : one
}

/**
 * Drive a foreground `shell:exec` through the background-job start/poll API so
 * the UI can stream output while the command runs (LiveToolActivity card).
 * The aggregated result mirrors the buffered `shell:exec` payload — including
 * its timeout (exit 124 + note), abort (exit 130, output discarded) and
 * sandbox/remote blocking (exit 126) semantics — so the persisted transcript
 * is unchanged. The poll loop always exits: on process death, deadline, or
 * abort; no interval outlives the promise.
 */
async function runForegroundWithLiveOutput(
  api: typeof window.api,
  opts: {
    jobId: string
    sandboxNote?: string
    timeoutMs: number
    signal: AbortSignal | undefined
    sessionId?: string
    liveEnabled: boolean
    label: string
    target: string
  }
): Promise<ShellExecResult> {
  const { jobId, signal, timeoutMs } = opts
  const startedAt = Date.now()
  let settled = false
  let latest: { stdout: string; stderr: string; exitCode: number | null; killed?: boolean } | null = null

  const pushLive = (stdout: string, stderr: string): void => {
    if (!opts.liveEnabled || !opts.sessionId) return
    const combined = [stdout, stderr].filter(Boolean).join('\n')
    const lines = combined ? combined.replace(/\n$/, '').split('\n') : []
    useStreamingStore.getState().setLiveTool(opts.sessionId, {
      jobId,
      label: opts.label,
      target: opts.target,
      startedAt,
      tail: lines.slice(-LIVE_TAIL_LINES).join('\n'),
      totalLines: lines.length,
      totalChars: combined.length
    })
  }

  return new Promise<ShellExecResult>((resolve) => {
    const finish = (r: ShellExecResult): void => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve(r)
    }
    // Stop/steer aborts kill this session's shells only (not other concurrent
    // turns) — identical to the buffered path, which discards partial output.
    const onAbort = (): void => {
      if (opts.sessionId && api.shell.killSession) {
        void api.shell.killSession(opts.sessionId).catch(() => {})
      } else {
        void api.shell.killAll?.().catch?.(() => {})
      }
      finish({ stdout: '', stderr: 'Command aborted (run stopped)', exitCode: 130, killed: true })
    }
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    void (async () => {
      pushLive('', '')
      for (;;) {
        if (settled) return
        const poll = await api.shell.poll(jobId).catch(() => null)
        if (settled) return
        if (!poll || poll.error) {
          finish({
            stdout: latest?.stdout || '',
            stderr: latest?.stderr || (poll?.error || 'Failed to poll command output'),
            exitCode: latest?.exitCode ?? 1,
            killed: latest?.killed,
            sandboxNote: opts.sandboxNote
          })
          return
        }
        latest = {
          stdout: poll.stdout || '',
          stderr: poll.stderr || '',
          exitCode: poll.exitCode ?? null,
          killed: poll.killed
        }
        pushLive(latest.stdout, latest.stderr)
        if (poll.status === 'exited') {
          finish({
            stdout: latest.stdout,
            stderr: latest.stderr,
            exitCode: typeof poll.exitCode === 'number' ? poll.exitCode : 1,
            killed: poll.killed,
            sandboxNote: opts.sandboxNote
          })
          return
        }
        // Mirror the buffered path's timeout: kill the child, report exit 124.
        if (Date.now() - startedAt >= timeoutMs) {
          await api.shell.kill(jobId).catch(() => {})
          const final = await api.shell.poll(jobId).catch(() => null)
          const stdout = final?.stdout || latest.stdout
          const stderrBase = final?.stderr || latest.stderr
          finish({
            stdout,
            stderr: (stderrBase ? `${stderrBase}\n` : '') + `Command timed out after ${timeoutMs}ms`,
            exitCode: 124,
            killed: true,
            sandboxNote: opts.sandboxNote
          })
          return
        }
        await sleep(LIVE_POLL_MS)
      }
    })()
  })
}

/** Shared final formatting for buffered and live foreground shell results. */
function shellResultPayload(
  toolCallId: string,
  result: ShellExecResult
): { toolCallId: string; content: string; host?: string; isError: boolean } {
  const parts = [result.stdout, result.stderr].filter(Boolean)
  if (result.killed) parts.push('(command killed — stopped or timed out)')
  if (result.sandboxNote) parts.push(`(${result.sandboxNote})`)
  const output = parts.join('\n')
  return {
    toolCallId,
    content: output || `(exit code: ${result.exitCode})`,
    ...(result.host ? { host: result.host } : {}),
    isError: result.exitCode !== 0 || Boolean(result.killed)
  }
}


/**
 * Sandbox options for an agent shell. User prefs are a ceiling: the model may
 * tighten (sandbox on, network off) but never loosen what the user configured.
 */
export function shellSandboxFor(
  args: Record<string, unknown>,
  projectPath: string | undefined,
  ctx?: ToolExecContext
): { enabled: boolean; network: boolean; projectRoot?: string; jailCwd: boolean; sessionId?: string; hostId?: string } {
  const prefs = useProviderStore.getState()
  const prefSandbox = prefs.shellSandbox !== false
  const prefNetwork = prefs.shellNetwork !== false
  return {
    enabled: prefSandbox ? true : args.sandbox === true,
    network: prefNetwork ? args.network !== false : false,
    projectRoot: projectPath,
    jailCwd: prefs.shellCwdJail !== false,
    sessionId: ctx?.sessionId,
    hostId: getProjectTarget(ctx?.projectId).hostId
  }
}

const shell_exec: ToolHandler = async (call, projectPath, signal, ctx, api) => {
        if (signal?.aborted) {
          return { toolCallId: call.id, content: 'Tool was not executed (run aborted).', isError: true }
        }
        const command = String(call.arguments.command || '').trim()
        if (!command) {
          return { toolCallId: call.id, content: 'command is required', isError: true }
        }
        const timeoutArg = Number(call.arguments.timeout)
        const timeoutMs = Number.isFinite(timeoutArg) && timeoutArg > 0
          ? Math.min(300_000, Math.max(5_000, timeoutArg * 1000))
          : undefined
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = cwd === '.' ? projectPath : cwd
        const background = Boolean(call.arguments.background)
        const sandbox = shellSandboxFor(call.arguments, projectPath, ctx)
        if (background) {
          const started = await api.shell.start(command, workDir, sandbox)
          if (started.error || !started.jobId) {
            return {
              toolCallId: call.id,
              content: started.error || 'Failed to start background job',
              isError: true
            }
          }
          watchJob(ctx?.subagent && ctx.subagentRunId ? `sub-${ctx.subagentRunId}` : ctx?.sessionId || 'default', started.jobId, command)
          return {
            toolCallId: call.id,
            content: `Background job started: ${started.jobId}${started.pid ? ` (pid ${started.pid})` : ''}${started.sandboxNote ? `\n(${started.sandboxNote})` : ''}\nUse shell_wait (until a pattern / port / exit) or shell_poll to check output; shell_kill to stop. New errors it prints are reported to you automatically.`
          }
        }
        // Foreground: prefer start+poll so the UI can stream output while the
        // command runs. Buffered exec stays the fallback (browser polyfill,
        // transports without start/poll) and the only path for remote SSH
        // targets, keeping their aggregated result shape identical.
        const liveCapable = typeof api.shell?.start === 'function' && typeof api.shell?.poll === 'function' && !sandbox.hostId
        if (liveCapable) {
          const started = await api.shell.start(command, workDir, sandbox)
          if (!started.error && started.jobId) {
            try {
              const result = await runForegroundWithLiveOutput(api, {
                jobId: started.jobId,
                sandboxNote: started.sandboxNote,
                timeoutMs: timeoutMs ?? 30_000,
                signal,
                sessionId: ctx?.sessionId,
                liveEnabled: Boolean(ctx?.sessionId) && !ctx?.subagent,
                label: 'Run command',
                target: clipLiveTarget(command)
              })
              return shellResultPayload(call.id, result)
            } finally {
              if (ctx?.sessionId) {
                useStreamingStore.getState().clearLiveTool(ctx.sessionId, started.jobId)
              }
            }
          }
          // start refused (blocked command, browser polyfill error, …): the
          // buffered exec below reproduces the same block with its standard
          // 126 / "blocked" payload, so behavior is unchanged.
        }
        const execPromise = api.shell.exec(command, workDir, timeoutMs, sandbox)
        const result = signal
          ? await Promise.race([
              execPromise,
              new Promise<Awaited<typeof execPromise>>((resolve) => {
                const onAbort = (): void => {
                  if (ctx?.sessionId && api.shell.killSession) {
                    void api.shell.killSession(ctx.sessionId).catch(() => {})
                  } else {
                    void api.shell.killAll?.().catch?.(() => {})
                  }
                  resolve({
                    stdout: '',
                    stderr: 'Command aborted (run stopped)',
                    exitCode: 130,
                    killed: true
                  })
                }
                if (signal.aborted) {
                  onAbort()
                  return
                }
                signal.addEventListener('abort', onAbort, { once: true })
                void execPromise.finally(() => signal.removeEventListener('abort', onAbort))
              })
            ])
          : await execPromise
        return shellResultPayload(call.id, result)
      }


const shell_poll: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const jobId = String(call.arguments.job_id || call.arguments.jobId || '')
        const polled = await api.shell.poll(jobId)
        if (polled.error) {
          return { toolCallId: call.id, content: polled.error, isError: true }
        }
        const header = `[${polled.status}] ${polled.command || jobId} (${polled.elapsedMs || 0}ms)`
        const body = [polled.stdout, polled.stderr].filter(Boolean).join('\n')
        markJobSeen(ctx?.subagent && ctx.subagentRunId ? `sub-${ctx.subagentRunId}` : ctx?.sessionId || 'default', jobId, (polled.stdout || '').length + (polled.stderr ? polled.stderr.length + 1 : 0))
        const detected = formatAnalysis(analyzeProcessOutput(body))
        const foot =
          polled.status === 'exited'
            ? `\n(exit ${polled.exitCode}${polled.killed ? ', killed' : ''})`
            : ''
        return {
          toolCallId: call.id,
          content: (header + (detected ? `\n${detected}` : '') + (body ? '\n' + (body.length > 22_000 ? `…${body.slice(-22_000)}` : body) : '') + foot).slice(0, 24000)
        }
      }


const shell_kill: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const jobId = String(call.arguments.job_id || call.arguments.jobId || '')
        const killed = await api.shell.kill(jobId)
        if (killed.error) {
          return { toolCallId: call.id, content: killed.error, isError: true }
        }
        return { toolCallId: call.id, content: `Killed job ${jobId}` }
      }


const terminal_list: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.terminal?.list) {
          return {
            toolCallId: call.id,
            content: 'Terminal list is only available in the desktop app.',
            isError: true
          }
        }
        const res = await api.terminal.list()
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'list failed', isError: true }
        const terms = res.terminals || []
        if (!terms.length) {
          return {
            toolCallId: call.id,
            content: 'No terminal sessions. Open the terminal panel first.'
          }
        }
        return {
          toolCallId: call.id,
          content: terms
            .map((t) => `- id=${t.id} alive=${t.alive} bufferChars=${t.bufferChars}`)
            .join('\n')
        }
      }


const terminal_read: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.terminal?.readBuffer) {
          return {
            toolCallId: call.id,
            content: 'Terminal read is only available in the desktop app.',
            isError: true
          }
        }
        let id = call.arguments.id ? String(call.arguments.id) : ''
        if (!id && api.terminal.list) {
          const listed = await api.terminal.list()
          id = listed.terminals?.[0]?.id || ''
        }
        if (!id) {
          return {
            toolCallId: call.id,
            content: 'No terminal id. Open a terminal or pass id from terminal_list.',
            isError: true
          }
        }
        const res = await api.terminal.readBuffer(
          id,
          call.arguments.max_chars !== undefined ? Number(call.arguments.max_chars) : undefined
        )
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'read failed', isError: true }
        return {
          toolCallId: call.id,
          content: [
            `terminal id=${res.id} alive=${res.alive}`,
            `returnedChars=${res.returnedChars} rawChars=${res.rawChars}`,
            '',
            res.text || '(empty buffer)'
          ].join('\n')
        }
      }


export const shellHandlers: Record<string, ToolHandler> = {
  'shell_exec': shell_exec,
  'shell_poll': shell_poll,
  'shell_kill': shell_kill,
  'terminal_list': terminal_list,
  'terminal_read': terminal_read,
}
