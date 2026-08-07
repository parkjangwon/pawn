import { describe, it, expect } from 'vitest'
import { isGitRepo, removeAgentWorktree } from '../worktree'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

describe('worktree helpers', () => {
  it('detects non-git directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-notgit-'))
    try {
      expect(isGitRepo(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects git repos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-git-'))
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
      expect(isGitRepo(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to remove paths outside project .pawn/worktrees', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-wt-'))
    try {
      const outside = join(tmpdir(), 'not-a-worktree')
      const res = removeAgentWorktree(dir, outside)
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/Refused/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
