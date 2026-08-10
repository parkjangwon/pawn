import { useSubagentRunsStore } from '../stores/subagentRuns'
import type { AgentApplyMode } from './agentProfiles'
import type { SubagentIsolation } from './subagentTypes'

// --- Worktree isolation + apply-back ---------------------------------------

export async function maybeCreateWorktree(
  projectPath: string | undefined,
  runId: string,
  isolation: SubagentIsolation
): Promise<{ cwd?: string; worktreePath?: string; branch?: string; note?: string }> {
  if (isolation !== 'worktree' || !projectPath || !window.api?.worktree?.create) {
    return { cwd: projectPath }
  }
  const res = await window.api.worktree.create(projectPath, runId)
  if (!res?.ok || !res.path) {
    return {
      cwd: projectPath,
      note: `worktree unavailable (${res?.error || 'unknown'}); using shared cwd`
    }
  }
  return { cwd: res.path, worktreePath: res.path, branch: res.branch }
}

export async function finalizeWorktree(
  opts: {
    projectPath?: string
    worktreePath?: string
    worktreeBranch?: string
    apply: AgentApplyMode
    ok: boolean
  }
): Promise<{
  filesChanged: string[]
  applied: boolean
  applyNote?: string
  applyConflicts?: string[]
  applyPending?: boolean
  keepWorktree?: boolean
}> {
  const { projectPath, worktreePath, worktreeBranch, apply, ok } = opts
  if (!worktreePath || !projectPath) {
    return { filesChanged: [], applied: false }
  }

  let filesChanged: string[] = []
  try {
    filesChanged = (await window.api.worktree?.changedFiles?.(worktreePath)) || []
  } catch {
    filesChanged = []
  }

  let applied = false
  let applyNote: string | undefined
  let applyConflicts: string[] | undefined
  let applyPending = false
  let keepWorktree = false

  if (ok && apply === 'review' && filesChanged.length > 0) {
    applyPending = true
    keepWorktree = true
    applyNote = `Review ${filesChanged.length} file(s) in Agents panel — Apply or Discard before the worktree is cleaned up.`
  } else if (ok && apply === 'auto' && filesChanged.length > 0 && window.api.worktree?.apply) {
    try {
      const res = await window.api.worktree.apply(projectPath, worktreePath)
      applied = res?.ok === true && (res.files?.length || 0) > 0
      if (res?.files?.length) filesChanged = res.files
      if (res?.conflicts?.length) {
        applyConflicts = res.conflicts
        // Keep worktree so the user can resolve / re-apply from Agents panel.
        applyPending = true
        keepWorktree = true
        applyNote =
          res.note ||
          `Applied with ${res.conflicts.length} conflict(s) — review in Agents panel`
      } else if (res?.error) {
        applyNote = res.error
        applyPending = true
        keepWorktree = true
      } else if (res?.note) applyNote = res.note
      else if (applied) applyNote = `Applied ${filesChanged.length} file(s) to project tree`
    } catch (err) {
      applyNote = `Apply failed: ${String(err)}`
      applyPending = true
      keepWorktree = true
    }
  } else if (ok && apply === 'none' && filesChanged.length > 0) {
    applyNote =
      'Worktree had changes but apply=none — changes discarded on cleanup. Re-run with apply=auto or apply=review to land them.'
  }

  if (!keepWorktree && window.api?.worktree?.remove) {
    void window.api.worktree.remove(projectPath, worktreePath, worktreeBranch).catch(() => {})
  }
  return { filesChanged, applied, applyNote, applyConflicts, applyPending, keepWorktree }
}

export async function applyPendingWorktree(runId: string): Promise<{ ok: boolean; error?: string }> {
  const store = useSubagentRunsStore.getState()
  const run = store.getById(runId)
  if (!run?.applyPending || !run.worktreePath || !run.projectPath) {
    return { ok: false, error: 'No pending worktree apply for this run' }
  }
  try {
    const res = await window.api.worktree?.apply?.(run.projectPath, run.worktreePath)
    if (!res?.ok) {
      store.patchRun(runId, {
        applyConflicts: res?.conflicts,
        error: res?.error || 'Apply failed'
      })
      return { ok: false, error: res?.error || 'Apply failed' }
    }
    if (window.api.worktree?.remove) {
      void window.api.worktree.remove(run.projectPath, run.worktreePath, run.worktreeBranch).catch(() => {})
    }
    store.patchRun(runId, {
      applied: true,
      applyPending: false,
      filesChanged: res.files || run.filesChanged,
      applyConflicts: res.conflicts,
      worktreePath: undefined,
      summary: (run.summary || '') + `\nApplied ${res.files?.length || 0} file(s).`
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Discard held worktree without applying. */
export async function discardPendingWorktree(runId: string): Promise<{ ok: boolean; error?: string }> {
  const store = useSubagentRunsStore.getState()
  const run = store.getById(runId)
  if (!run?.worktreePath || !run.projectPath) {
    return { ok: false, error: 'No worktree to discard' }
  }
  try {
    if (window.api.worktree?.remove) {
      await window.api.worktree.remove(run.projectPath, run.worktreePath, run.worktreeBranch)
    }
    store.patchRun(runId, {
      applyPending: false,
      applied: false,
      worktreePath: undefined,
      summary: (run.summary || '') + '\nWorktree discarded without applying.'
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

