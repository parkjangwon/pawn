import { describe, it, expect } from 'vitest'
import {
  isGitRepo,
  removeAgentWorktree,
  createAgentWorktree,
  applyWorktreeToProject,
  worktreeChangedFiles
} from '../worktree'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
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

  it('applies worktree file changes onto the main tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-wt-apply-'))
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' })
      writeFileSync(join(dir, 'hello.txt'), 'v1\n', 'utf8')
      spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })

      const wt = createAgentWorktree(dir, 'run-apply-1')
      expect(wt.ok).toBe(true)
      if (!wt.ok) return
      writeFileSync(join(wt.path, 'hello.txt'), 'v2-from-worktree\n', 'utf8')
      writeFileSync(join(wt.path, 'new.txt'), 'brand-new\n', 'utf8')
      const changed = worktreeChangedFiles(wt.path)
      expect(changed.length).toBeGreaterThan(0)

      const applied = applyWorktreeToProject(dir, wt.path)
      expect(applied.ok).toBe(true)
      expect(readFileSync(join(dir, 'hello.txt'), 'utf8')).toContain('v2-from-worktree')
      expect(readFileSync(join(dir, 'new.txt'), 'utf8')).toContain('brand-new')

      removeAgentWorktree(dir, wt.path, wt.branch)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports overwrite conflicts when main diverged from worktree base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-wt-conflict-'))
    try {
      spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' })
      writeFileSync(join(dir, 'shared.txt'), 'base\n', 'utf8')
      spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
      spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })

      const wt = createAgentWorktree(dir, 'run-conflict-1')
      expect(wt.ok).toBe(true)
      if (!wt.ok) return

      // Main and worktree both edit the same path differently.
      writeFileSync(join(dir, 'shared.txt'), 'main-local-edit\n', 'utf8')
      writeFileSync(join(wt.path, 'shared.txt'), 'worktree-edit\n', 'utf8')

      const applied = applyWorktreeToProject(dir, wt.path)
      expect(applied.ok).toBe(true)
      expect(applied.conflicts).toContain('shared.txt')
      expect(applied.note).toMatch(/conflict/i)
      // Worktree result still lands (explicit apply) — conflict is informational.
      expect(readFileSync(join(dir, 'shared.txt'), 'utf8')).toContain('worktree-edit')

      removeAgentWorktree(dir, wt.path, wt.branch)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
