/**
 * Cheap, session-cached repository map (Aider-inspired).
 * No network, no paid embeddings — walk + definition heuristics.
 */

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|vue|svelte|c|cc|cpp|h|hpp|cs)$/i
const SKIP = /(^|\/)(node_modules|\.git|dist|out|build|coverage|\.next|target|vendor|\.venv|venv)(\/|$)/i

const DEF_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var|def|fn|struct|impl|trait|module)\s+([A-Za-z_][\w]*)/g

export type RepoMapOptions = {
  maxFiles?: number
  maxSymbolsPerFile?: number
  maxChars?: number
}

type CacheEntry = { at: number; text: string; fileCount: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

export function clearRepoMapCache(root?: string): void {
  if (!root) {
    cache.clear()
    return
  }
  cache.delete(root.replace(/\/$/, ''))
}

function scorePath(p: string): number {
  if (p.includes('/src/')) return 0
  if (SOURCE_EXT.test(p)) return 1
  return 2
}

function extractSymbols(content: string, max: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  DEF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DEF_RE.exec(content)) !== null) {
    const name = m[1]
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length >= max) break
  }
  return out
}

/**
 * Build a compact repo map for LLM context.
 * Returns markdown; empty string on failure / no path.
 */
export async function buildRepoMap(
  projectPath: string,
  opts: RepoMapOptions = {}
): Promise<{ text: string; fileCount: number; fromCache: boolean }> {
  const root = projectPath.replace(/\/$/, '')
  if (!root) return { text: '', fileCount: 0, fromCache: false }

  const maxFiles = Math.min(Math.max(opts.maxFiles ?? 80, 10), 200)
  const maxSym = Math.min(Math.max(opts.maxSymbolsPerFile ?? 8, 1), 20)
  const maxChars = Math.min(Math.max(opts.maxChars ?? 12_000, 2000), 40_000)

  const hit = cache.get(root)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { text: hit.text, fileCount: hit.fileCount, fromCache: true }
  }

  const walk = await window.api.fs.walk(root)
  if (!Array.isArray(walk)) {
    return { text: `repo_map failed: ${(walk as { error?: string }).error || 'walk error'}`, fileCount: 0, fromCache: false }
  }

  let files = walk.filter((f) => {
    if (f.isDirectory) return false
    const p = f.path.replace(/\\/g, '/')
    if (SKIP.test(p)) return false
    return SOURCE_EXT.test(p)
  })
  files = files.sort((a, b) => scorePath(a.path) - scorePath(b.path) || a.path.length - b.path.length)
  const selected = files.slice(0, maxFiles)

  const rootNorm = (root.endsWith('/') ? root : root + '/').replace(/\\/g, '/')
  const reads = await window.api.fs.readFiles(selected.map((f) => f.path))

  const lines: string[] = [
    `# Repository map`,
    `root: ${root}`,
    `source_files_scanned: ${selected.length} / ${files.length}`,
    ``
  ]

  for (const item of reads) {
    if (typeof item.content !== 'string') continue
    let rel = item.path.replace(/\\/g, '/')
    if (rel.startsWith(rootNorm)) rel = rel.slice(rootNorm.length)
    const syms = extractSymbols(item.content, maxSym)
    if (syms.length) lines.push(`${rel}: ${syms.join(', ')}`)
    else lines.push(`${rel}`)
  }

  let text = lines.join('\n')
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + `\n…(truncated; call repo_map with focus or use codebase_search)`
  }

  cache.set(root, { at: Date.now(), text, fileCount: selected.length })
  return { text, fileCount: selected.length, fromCache: false }
}

/** Short preamble block (uncached inject — keep small). */
export async function repoMapPreamble(projectPath: string): Promise<string> {
  const { text, fileCount } = await buildRepoMap(projectPath, {
    maxFiles: 48,
    maxSymbolsPerFile: 5,
    maxChars: 6_000
  })
  if (!text || fileCount === 0) return ''
  return (
    `--- Repository Map (local, untrusted structure) ---\n` +
    `Use this as a rough index; re-read files before editing. Prefer codebase_search for precise lookup.\n` +
    text
  )
}
