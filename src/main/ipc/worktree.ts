import { handleTrusted } from './trust'
import {
  createAgentWorktree,
  removeAgentWorktree,
  worktreeDiffStat,
  worktreeDiffPatch,
  worktreeChangedFiles,
  applyWorktreeToProject
} from '../worktree'

export function registerWorktreeIpc(): void {
  handleTrusted('worktree:create', async (_e, projectPath: string, runId: string) => {
    if (typeof projectPath !== 'string' || !projectPath) {
      return { ok: false, error: 'projectPath required' }
    }
    return createAgentWorktree(projectPath, String(runId || 'run'))
  })

  handleTrusted(
    'worktree:remove',
    async (_e, projectPath: string, worktreePath: string, branch?: string) => {
      if (typeof projectPath !== 'string' || typeof worktreePath !== 'string') {
        return { ok: false, error: 'paths required' }
      }
      return removeAgentWorktree(
        projectPath,
        worktreePath,
        typeof branch === 'string' ? branch : undefined
      )
    }
  )

  handleTrusted('worktree:diffStat', async (_e, worktreePath: string) => {
    if (typeof worktreePath !== 'string' || !worktreePath) return ''
    return worktreeDiffStat(worktreePath)
  })

  handleTrusted('worktree:diffPatch', async (_e, worktreePath: string) => {
    if (typeof worktreePath !== 'string' || !worktreePath) return ''
    return worktreeDiffPatch(worktreePath)
  })

  handleTrusted('worktree:changedFiles', async (_e, worktreePath: string) => {
    if (typeof worktreePath !== 'string' || !worktreePath) return []
    return worktreeChangedFiles(worktreePath)
  })

  handleTrusted(
    'worktree:apply',
    async (_e, projectPath: string, worktreePath: string) => {
      if (typeof projectPath !== 'string' || typeof worktreePath !== 'string') {
        return { ok: false, files: [], error: 'paths required' }
      }
      return applyWorktreeToProject(projectPath, worktreePath)
    }
  )
}
