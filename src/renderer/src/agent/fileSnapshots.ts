/**
 * What the agent last saw of each file, per session (or subagent run).
 *
 * read_file / write_file / edit_file record a content fingerprint. Before a
 * whole-file overwrite we compare it with the disk: if the file changed since
 * the agent last looked (user edit in the editor, formatter, git checkout),
 * the overwrite would silently discard that work, so it is refused until the
 * agent re-reads the file.
 */

const MAX_SCOPES = 64
const MAX_FILES_PER_SCOPE = 2000

const scopes = new Map<string, Map<string, string>>()

/** Fast, stable 64-bit-ish fingerprint (two FNV-1a lanes + length). */
export function fingerprint(content: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return `${content.length.toString(36)}:${h1.toString(36)}:${h2.toString(36)}`
}

function normPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function scopeMap(scope: string, create: boolean): Map<string, string> | undefined {
  let m = scopes.get(scope)
  if (!m && create) {
    if (scopes.size >= MAX_SCOPES) {
      const oldest = scopes.keys().next().value
      if (oldest !== undefined) scopes.delete(oldest)
    }
    m = new Map()
    scopes.set(scope, m)
  }
  return m
}

export function snapshotScope(ctx?: { sessionId?: string; subagentRunId?: string }): string {
  return ctx?.subagentRunId ? `sub:${ctx.subagentRunId}` : `session:${ctx?.sessionId || 'default'}`
}

/** Record the content the agent now knows (after a read or its own write). */
export function noteFileSeen(scope: string, path: string, content: string): void {
  const m = scopeMap(scope, true)!
  const key = normPath(path)
  m.delete(key) // refresh insertion order (LRU-ish)
  m.set(key, fingerprint(content))
  if (m.size > MAX_FILES_PER_SCOPE) {
    const oldest = m.keys().next().value
    if (oldest !== undefined) m.delete(oldest)
  }
}

export function forgetFile(scope: string, path: string): void {
  scopeMap(scope, false)?.delete(normPath(path))
}

export function clearSnapshotScope(scope: string): void {
  scopes.delete(scope)
}

export type StaleState = 'unknown' | 'fresh' | 'stale'

/**
 * `unknown`: the agent never read/wrote this file in this scope.
 * `fresh`: disk matches what the agent last saw.
 * `stale`: disk changed since then.
 */
export function checkStale(scope: string, path: string, current: string): StaleState {
  const seen = scopeMap(scope, false)?.get(normPath(path))
  if (!seen) return 'unknown'
  return seen === fingerprint(current) ? 'fresh' : 'stale'
}

export function __resetFileSnapshotsForTests(): void {
  scopes.clear()
}
