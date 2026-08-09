import { resolveToolPath } from '../pathUtils'
import { useProviderStore } from '../../stores/provider'
import type { ToolHandler } from './types'


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
        const prefs = useProviderStore.getState()
        const sandboxEnabled =
          call.arguments.sandbox === false
            ? false
            : call.arguments.sandbox === true
              ? true
              : prefs.shellSandbox !== false
        const network =
          call.arguments.network === false
            ? false
            : call.arguments.network === true
              ? true
              : prefs.shellNetwork !== false
        const sandbox = {
          enabled: sandboxEnabled,
          network,
          projectRoot: projectPath,
          jailCwd: prefs.shellCwdJail !== false,
          sessionId: ctx?.sessionId
        }
        if (background) {
          const started = await api.shell.start(command, workDir, sandbox)
          if (started.error || !started.jobId) {
            return {
              toolCallId: call.id,
              content: started.error || 'Failed to start background job',
              isError: true
            }
          }
          return {
            toolCallId: call.id,
            content: `Background job started: ${started.jobId}${started.pid ? ` (pid ${started.pid})` : ''}${started.sandboxNote ? `\n(${started.sandboxNote})` : ''}\nUse shell_poll with job_id to check output; shell_kill to stop.`
          }
        }
        // Stop/steer aborts kill this session's shells only (not other concurrent turns).
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
        const parts = [result.stdout, result.stderr].filter(Boolean)
        if (result.killed) parts.push('(command killed — stopped or timed out)')
        if (result.sandboxNote) parts.push(`(${result.sandboxNote})`)
        const output = parts.join('\n')
        return {
          toolCallId: call.id,
          content: output || `(exit code: ${result.exitCode})`,
          isError: result.exitCode !== 0 || Boolean(result.killed)
        }
      }


const shell_poll: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const jobId = String(call.arguments.job_id || call.arguments.jobId || '')
        const polled = await api.shell.poll(jobId)
        if (polled.error) {
          return { toolCallId: call.id, content: polled.error, isError: true }
        }
        const header = `[${polled.status}] ${polled.command || jobId} (${polled.elapsedMs || 0}ms)`
        const body = [polled.stdout, polled.stderr].filter(Boolean).join('\n')
        const foot =
          polled.status === 'exited'
            ? `\n(exit ${polled.exitCode}${polled.killed ? ', killed' : ''})`
            : ''
        return {
          toolCallId: call.id,
          content: (header + (body ? '\n' + body : '') + foot).slice(0, 24000)
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
