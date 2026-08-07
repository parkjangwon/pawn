/**
 * Git worktree helpers for isolated subagent workers.
 * Creates a disposable worktree under <repo>/.pawn/worktrees/<id>.
 */
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join, resolve, sep } from 'path'
import { spawnSync } from 'child_process'

export type WorktreeResult =
  | { ok: true; path: string; branch: string }
  | { ok: false; error: string }

function runGit(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: process.env
  })
  return {
    code: typeof r.status === 'number' ? r.status : 1,
    stdout: r.stdout || '',
    stderr: r.stderr || ''
  }
}

export function isGitRepo(cwd: string): boolean {
  const r = runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  return r.code === 0 && r.stdout.trim() === 'true'
}

/**
 * Create a worktree on a new branch from HEAD.
 */
export function createAgentWorktree(projectPath: string, runId: string): WorktreeResult {
  const root = resolve(projectPath)
  if (!root || root.includes('\0')) {
    return { ok: false, error: 'Invalid project path' }
  }
  if (!isGitRepo(root)) {
    return { ok: false, error: 'Not a git repository — worktree isolation unavailable' }
  }
  const safeId = runId.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'run'
  const branch = `pawn/agent-${safeId}`
  const base = join(root, '.pawn', 'worktrees')
  const path = join(base, safeId)
  // Ensure worktree path cannot escape project root
  const pathResolved = resolve(path)
  const rootPrefix = root.endsWith(sep) ? root : root + sep
  if (pathResolved !== root && !pathResolved.startsWith(rootPrefix)) {
    return { ok: false, error: 'Refused worktree path outside project root' }
  }
  try {
    mkdirSync(base, { recursive: true })
  } catch (err) {
    return { ok: false, error: `Failed to create worktree dir: ${String(err)}` }
  }
  if (existsSync(path)) {
    // Reuse path after cleanup
    removeAgentWorktree(root, path, branch)
  }

  // Prefer current HEAD
  const add = runGit(root, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  if (add.code !== 0) {
    // Branch may already exist
    const add2 = runGit(root, ['worktree', 'add', path, branch])
    if (add2.code !== 0) {
      return {
        ok: false,
        error: add.stderr || add2.stderr || 'git worktree add failed'
      }
    }
  }
  return { ok: true, path, branch }
}

export function removeAgentWorktree(
  projectPath: string,
  worktreePath: string,
  branch?: string
): { ok: boolean; error?: string } {
  const root = resolve(projectPath)
  const wt = resolve(worktreePath)
  const rootPrefix = root.endsWith(sep) ? root : root + sep
  // Never rmSync paths outside the project's .pawn/worktrees tree.
  if (wt !== root && !wt.startsWith(rootPrefix)) {
    return { ok: false, error: 'Refused to remove worktree outside project root' }
  }
  const marker = `${sep}.pawn${sep}worktrees${sep}`
  if (!wt.includes(marker) && !wt.endsWith(`${sep}.pawn${sep}worktrees`)) {
    return { ok: false, error: 'Refused to remove path that is not a Pawn worktree' }
  }
  const rem = runGit(root, ['worktree', 'remove', '--force', wt])
  if (rem.code !== 0) {
    try {
      rmSync(wt, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    runGit(root, ['worktree', 'prune'])
  }
  if (branch && /^pawn\/agent-[\w.-]+$/.test(branch)) {
    runGit(root, ['branch', '-D', branch])
  }
  return { ok: true }
}

/** Summarize diff vs main project HEAD for the parent agent. */
export function worktreeDiffStat(worktreePath: string): string {
  const r = runGit(worktreePath, ['diff', '--stat', 'HEAD'])
  const st = runGit(worktreePath, ['status', '--short'])
  const parts = [r.stdout.trim(), st.stdout.trim()].filter(Boolean)
  return parts.join('\n') || '(no local changes in worktree)'
}
