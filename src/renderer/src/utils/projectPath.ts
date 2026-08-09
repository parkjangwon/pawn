/**
 * Resolve which project folder is "active" for UI panels and tools.
 * Prefer the session-bound multi-root path when it is still in the project list.
 */

export interface ProjectPathSource {
  paths?: string[]
  sessions?: Array<{ id: string; path?: string }>
}

export function getEffectiveProjectPath(
  project: ProjectPathSource | null | undefined,
  sessionId?: string | null
): string {
  const paths = (project?.paths || []).filter(Boolean)
  if (!paths.length) return ''
  if (sessionId) {
    const session = project?.sessions?.find((s) => s.id === sessionId)
    if (session?.path && paths.includes(session.path)) return session.path
  }
  return paths[0]
}

/** Index of the effective root in project.paths (for chip UI). */
export function getEffectiveRootIndex(
  project: ProjectPathSource | null | undefined,
  sessionId?: string | null
): number {
  const paths = (project?.paths || []).filter(Boolean)
  if (!paths.length) return 0
  const path = getEffectiveProjectPath(project, sessionId)
  const idx = paths.indexOf(path)
  return idx >= 0 ? idx : 0
}
