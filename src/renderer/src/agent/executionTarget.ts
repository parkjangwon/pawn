/**
 * Per-project execution target (local | SSH host). A remote project keeps the
 * agent loop and LLM keys on this machine; only tool execution ships over an
 * ssh channel. The host id is validated again in the main process against
 * ~/.pawn/ssh.json — the renderer cannot point execution at an arbitrary host.
 */

import { useAppStore } from '../stores/app'
import { APPLY_PATCH_NAME, TEXT_EDITOR_NAME } from './nativeTools'
import type { ToolExecContext } from './toolHandlers/types'

export interface ExecutionTarget {
  hostId?: string
  hostLabel?: string
  remotePath?: string
}

export function getProjectTarget(projectId?: string): ExecutionTarget {
  if (!projectId) return {}
  const p = useAppStore.getState().projects.find((pr) => pr.id === projectId)
  if (!p?.executionHost) return {}
  return { hostId: p.executionHost, remotePath: p.remotePath || undefined }
}

/** The path tools should use: the remote repo path when the project is remote. */
export function effectiveProjectPath(projectId: string | undefined, projectPath?: string): string | undefined {
  const t = getProjectTarget(projectId)
  return t.hostId && t.remotePath ? t.remotePath : projectPath
}

/** sandboxOpts fragment carrying the target into the main-process shell IPC. */
export function targetSandboxOpts(projectId?: string): { hostId?: string } {
  const t = getProjectTarget(projectId)
  return t.hostId ? { hostId: t.hostId } : {}
}

/**
 * execFile bound to the project's execution target, for tool handlers that
 * shell out directly (git tools, runChecks).
 */
export function execFileFor(
  ctx: ToolExecContext | undefined,
  api: typeof window.api
): (file: string, args: string[], cwd?: string, timeoutMs?: number) => ReturnType<typeof window.api.shell.execFile> {
  const opts = targetSandboxOpts(ctx?.projectId)
  return (file, args, cwd, timeoutMs) => api.shell.execFile(file, args, cwd, timeoutMs, Object.keys(opts).length ? opts : undefined)
}

/**
 * Tools that touch the local filesystem or local processes: they would
 * silently operate on the WRONG machine for a remote project, so they are
 * refused with an explicit message instead.
 */
const LOCAL_ONLY_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'delete_file',
  'list_dir',
  'grep_search',
  'semantic_search',
  'codebase_search',
  TEXT_EDITOR_NAME,
  APPLY_PATCH_NAME
])

const LOCAL_ONLY_PREFIXES = ['lsp_', 'debug_', 'worktree']

export function isLocalOnlyTool(name: string): boolean {
  return LOCAL_ONLY_TOOLS.has(name) || LOCAL_ONLY_PREFIXES.some((p) => name.startsWith(p))
}
