/**
 * Path helpers for tool execution. Pure — unit-testable without Electron.
 */

/** Resolve tool path args against the active project root when relative. */
export function resolveToolPath(raw: string | undefined, projectPath?: string): string {
  const p = (raw || '').trim()
  if (!p) return projectPath || '.'
  // Absolute POSIX or Windows drive path
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return p
  // UNC paths
  if (p.startsWith('\\\\')) return p
  if (!projectPath) return p
  const base = projectPath.replace(/[/\\]+$/, '')
  const rel = p.replace(/^\.\//, '')
  // Prefer forward slashes in tool I/O; Node/Electron accept them on Windows too
  return `${base}/${rel}`
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

const DEFAULT_READ_LINES = 500
const MAX_READ_CHARS = 100_000

/**
 * Format file content with optional 1-based line window and line numbers.
 * When the file is short enough and no offset/limit requested, returns raw text
 * for cache stability with small files.
 */
export function formatFileRead(
  text: string,
  opts: { offset?: number; limit?: number; forceWindow?: boolean } = {}
): string {
  const lines = text.split('\n')
  const total = lines.length
  const hasWindow =
    opts.forceWindow ||
    opts.offset !== undefined ||
    opts.limit !== undefined ||
    text.length > MAX_READ_CHARS ||
    total > DEFAULT_READ_LINES

  if (!hasWindow) {
    return text
  }

  const offset = Math.max(1, Number(opts.offset) || 1)
  const limit = Math.min(5000, Math.max(1, Number(opts.limit) || DEFAULT_READ_LINES))
  const slice = lines.slice(offset - 1, offset - 1 + limit)
  let body = slice.map((line, i) => `${String(offset + i).padStart(6)}|${line}`).join('\n')

  if (body.length > MAX_READ_CHARS) {
    body = body.slice(0, MAX_READ_CHARS) + '\n...[truncated by size]'
  }

  const endLine = Math.min(offset + slice.length - 1, total)
  const header = `lines ${offset}-${endLine} of ${total}`
  const footer =
    offset - 1 + limit < total
      ? `\n\n...[${total - (offset - 1 + slice.length)} more lines — use offset/limit to continue]`
      : ''

  return `${header}\n${body}${footer}`
}
