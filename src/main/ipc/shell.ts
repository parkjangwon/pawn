import { ipcMain } from 'electron'
import { handleTrusted } from './trust'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export function registerShellIpc(): void {
  handleTrusted('shell:exec', async (_, command: string, cwd?: string) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || undefined,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code || 1 }
    }
  })
}
