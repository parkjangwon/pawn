import { ipcMain } from 'electron'
import { handleTrusted } from './trust'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

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
}

function errorPayload(err: unknown): { stdout: string; stderr: string; exitCode: number } {
  const e = err as ExecError
  return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code || 1 }
}

export function registerShellIpc(): void {
  handleTrusted('shell:exec', async (_, command: string, cwd?: string, timeoutMs?: number) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || undefined,
        timeout: clampTimeout(timeoutMs),
        maxBuffer: 10 * 1024 * 1024
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (err: unknown) {
      return errorPayload(err)
    }
  })

  // Argument-array variant for anything that must never go through a shell.
  // The command name and every argument are passed to execFile directly, so
  // user- or repo-controlled values cannot inject shell metacharacters.
  handleTrusted('shell:execFile', async (_event, file: string, args: unknown, cwd?: string, timeoutMs?: number) => {
    if (typeof file !== 'string' || !file.trim()) return { error: 'Invalid command' }
    const argList = Array.isArray(args)
      ? args.filter((a): a is string => typeof a === 'string')
      : []
    try {
      const { stdout, stderr } = await execFileAsync(file, argList, {
        cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined,
        timeout: clampTimeout(timeoutMs),
        maxBuffer: 10 * 1024 * 1024
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (err: unknown) {
      return errorPayload(err)
    }
  })
}
