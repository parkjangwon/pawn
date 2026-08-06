import { resolveToolPath } from '../pathUtils'
import { gitPrReady } from '../gitPrReady'
import type { ToolHandler } from './types'


const git_pr_ready: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const base = call.arguments.base ? String(call.arguments.base) : undefined
        const text = await gitPrReady(workDir, base)
        return { toolCallId: call.id, content: text }
      }


const git_log: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const limit = Math.min(50, Math.max(1, Number(call.arguments.limit) || 15))
        const result = await api.shell.execFile(
          'git',
          ['log', `-n${limit}`, '--oneline', '--decorate'],
          workDir,
          15_000
        )
        if (result.exitCode !== 0 && !result.stdout) {
          return {
            toolCallId: call.id,
            content: result.stderr || 'git log failed',
            isError: true
          }
        }
        return { toolCallId: call.id, content: result.stdout.trim() || '(no commits)' }
      }


const git_status: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const [branch, status] = await Promise.all([
          api.shell.execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workDir, 15_000),
          api.shell.execFile('git', ['status', '--short', '--branch'], workDir, 15_000)
        ])
        if (status.exitCode !== 0 && branch.exitCode !== 0) {
          return {
            toolCallId: call.id,
            content: status.stderr || branch.stderr || 'Not a git repository',
            isError: true
          }
        }
        const lines = [
          branch.exitCode === 0 ? `branch: ${branch.stdout.trim()}` : null,
          status.stdout.trim() || '(clean working tree)'
        ].filter(Boolean)
        return { toolCallId: call.id, content: lines.join('\n') }
      }


const git_diff: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const pathArg = call.arguments.path ? resolveToolPath(String(call.arguments.path), projectPath) : ''
        const stagedOnly = Boolean(call.arguments.staged)
        const argsBase = stagedOnly
          ? ['diff', '--cached', '--no-color']
          : ['diff', 'HEAD', '--no-color']
        // For unstaged-only when not stagedOnly, show working tree vs index AND index vs HEAD
        // via `git diff HEAD` which covers both.
        const args = pathArg ? [...argsBase, '--', pathArg] : argsBase
        const result = await api.shell.execFile('git', args, workDir, 30_000)
        if (result.exitCode !== 0 && !result.stdout) {
          return {
            toolCallId: call.id,
            content: result.stderr || 'git diff failed',
            isError: true
          }
        }
        const text = result.stdout || '(no changes)'
        const cap = 40_000
        return {
          toolCallId: call.id,
          content: text.length > cap ? text.slice(0, cap) + `\n...(truncated ${text.length - cap} chars)` : text
        }
      }


export const gitHandlers: Record<string, ToolHandler> = {
  'git_pr_ready': git_pr_ready,
  'git_log': git_log,
  'git_status': git_status,
  'git_diff': git_diff,
}
