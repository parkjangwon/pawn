/**
 * Git worktree helpers for isolated subagent workers.
 * Creates a disposable worktree under <repo>/.pawn/worktrees/<id>.
 */
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { spawnSync } from 'child_process'

function readTextSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

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

/** Unified patch of worktree changes (tracked + untracked as best-effort). */
export function worktreeDiffPatch(worktreePath: string): string {
  const wt = resolve(worktreePath)
  const tracked = runGit(wt, ['diff', 'HEAD', '--'])
  // Include untracked files as /dev/null diffs when possible.
  const untracked = runGit(wt, ['ls-files', '--others', '--exclude-standard'])
  const parts: string[] = []
  if (tracked.stdout.trim()) parts.push(tracked.stdout.trim())
  for (const rel of untracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 80)) {
    const show = runGit(wt, ['diff', '--no-index', '--', '/dev/null', rel])
    // git diff --no-index exits 1 when files differ — still has stdout.
    if (show.stdout.trim()) parts.push(show.stdout.trim())
  }
  return parts.join('\n')
}

export function worktreeChangedFiles(worktreePath: string): string[] {
  const wt = resolve(worktreePath)
  const st = runGit(wt, ['status', '--porcelain'])
  const files: string[] = []
  for (const line of st.stdout.split('\n')) {
    if (!line.trim()) continue
    // " M path", "?? path", "R  old -> new"
    const rest = line.slice(3).trim()
    if (rest.includes(' -> ')) {
      files.push(rest.split(' -> ').pop()!.trim())
    } else {
      files.push(rest)
    }
  }
  return Array.from(new Set(files))
}

/**
 * Apply worktree file changes onto the main project tree by copying changed
 * file contents (and deleting removed paths). Safer than merge when the main
 * tree may have unrelated dirty files.
 */
export function applyWorktreeToProject(
  projectPath: string,
  worktreePath: string
): {
  ok: boolean
  files: string[]
  /** Paths where main tree diverged from the worktree base AND from the worktree result. */
  conflicts?: string[]
  error?: string
  note?: string
} {
  const root = resolve(projectPath)
  const wt = resolve(worktreePath)
  if (!isGitRepo(root)) {
    return { ok: false, files: [], error: 'Main path is not a git repository' }
  }
  const status = runGit(wt, ['status', '--porcelain'])
  if (status.code !== 0) {
    return { ok: false, files: [], error: status.stderr || 'worktree status failed' }
  }
  if (!status.stdout.trim()) {
    return { ok: true, files: [], note: 'No worktree changes to apply' }
  }

  const applied: string[] = []
  const conflicts: string[] = []
  const errors: string[] = []
  for (const line of status.stdout.split('\n')) {
    if (!line.trim()) continue
    const code = line.slice(0, 2)
    let rel = line.slice(3).trim()
    if (rel.includes(' -> ')) rel = rel.split(' -> ').pop()!.trim()
    // Reject path escape
    const dest = resolve(root, rel)
    const rootPrefix = root.endsWith(sep) ? root : root + sep
    if (dest !== root && !dest.startsWith(rootPrefix)) {
      errors.push(`skip unsafe path: ${rel}`)
      continue
    }
    const src = resolve(wt, rel)
    const deleted = code.includes('D') || code === ' D'
    try {
      if (deleted) {
        // Conflict: main still has the file and it diverged from worktree HEAD.
        if (existsSync(dest)) {
          const mainText = readTextSafe(dest)
          const baseBlob = runGit(wt, ['show', `HEAD:${rel}`])
          const baseText = baseBlob.code === 0 ? baseBlob.stdout : null
          if (mainText != null && baseText != null && mainText !== baseText) {
            conflicts.push(rel)
          }
        }
        try {
          rmSync(dest, { force: true })
          applied.push(rel + ' (deleted)')
        } catch (err) {
          errors.push(`${rel}: ${String(err)}`)
        }
        continue
      }
      // Ensure parent dirs
      const parent = dest.slice(0, dest.lastIndexOf(sep))
      if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true })
      try {
        let wtContent: string | null = null
        if (existsSync(src)) {
          wtContent = readTextSafe(src)
        } else {
          const blob = runGit(wt, ['show', `HEAD:${rel}`])
          if (blob.code === 0) wtContent = blob.stdout
        }
        if (wtContent == null) {
          errors.push(`${rel}: source missing`)
          continue
        }
        // Conflict when main edited the same path after worktree spawn:
        // main ≠ worktree-base AND main ≠ worktree-result.
        if (existsSync(dest)) {
          const mainText = readTextSafe(dest)
          const baseBlob = runGit(wt, ['show', `HEAD:${rel}`])
          const baseText = baseBlob.code === 0 ? baseBlob.stdout : null
          if (
            mainText != null &&
            baseText != null &&
            mainText !== baseText &&
            mainText !== wtContent
          ) {
            conflicts.push(rel)
          }
        }
        writeFileSync(dest, wtContent, 'utf8')
        applied.push(rel)
      } catch (err) {
        errors.push(`${rel}: ${String(err)}`)
      }
    } catch (err) {
      errors.push(`${rel}: ${String(err)}`)
    }
  }

  if (applied.length === 0 && errors.length) {
    return { ok: false, files: [], conflicts, error: errors.slice(0, 5).join('; ') }
  }
  const noteParts: string[] = []
  if (errors.length) noteParts.push(`partial errors: ${errors.slice(0, 3).join('; ')}`)
  if (conflicts.length) {
    noteParts.push(
      `overwrite conflicts (main had diverged edits): ${conflicts.slice(0, 8).join(', ')}` +
        (conflicts.length > 8 ? ` (+${conflicts.length - 8} more)` : '')
    )
  }
  return {
    ok: true,
    files: applied,
    conflicts: conflicts.length ? conflicts : undefined,
    note: noteParts.length ? noteParts.join(' · ') : undefined
  }
}
