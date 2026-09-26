/**
 * Dependency-free set of sessions with an active Ultra Work run.
 * The provider store reads it (harnessModeFor → MAXING) without importing
 * the ultraWork store, which would create an import cycle.
 */
const active = new Set<string>()

export function setUltraWorkSession(sessionId: string, on: boolean): void {
  if (on) active.add(sessionId)
  else active.delete(sessionId)
}

export function isUltraWorkSession(sessionId: string | null | undefined): boolean {
  return !!sessionId && active.has(sessionId)
}
