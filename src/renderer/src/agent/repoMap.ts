/**
 * Session-cached repository map (Aider-inspired) with richer symbol extraction
 * and mtime fingerprint invalidation so external edits don't stick stale maps.
 */

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|vue|svelte|c|cc|cpp|h|hpp|cs)$/i
const SKIP = /(^|\/)(node_modules|\.git|dist|out|build|coverage|\.next|target|vendor|\.venv|venv)(\/|$)/i

const DEF_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var|def|fn|struct|impl|trait|module|pub\s+(?:fn|struct|enum|trait)|func)\s+([A-Za-z_][\w]*)/g

/** Extra: export { Foo }, export default Name, method-like in classes (light). */
const EXTRA_RE = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)/g,
  /\bexport\s+(?:type|interface|class|enum)\s+([A-Za-z_][\w]*)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_][\w]*)/g,
  /^\s*(?:public|private|protected)?\s*(?:async\s+)?([A-Za-z_][\w]*)\s*\([^)]*\)\s*[:{]/gm,
  /^\s*([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?\(/gm
]

export type RepoMapOptions = {
  maxFiles?: number
  maxSymbolsPerFile?: number
  maxChars?: number
  /** Force rebuild even if cache is warm. */
  force?: boolean
}

type CacheEntry = {
  at: number
  text: string
  fileCount: number
  fingerprint: string
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 45_000

/** Generation bumped on clearRepoMapCache — busts TTL early after agent edits. */
let mapGeneration = 0
const genByRoot = new Map<string, number>()

export function clearRepoMapCache(root?: string): void {
  mapGeneration++
  if (!root) {
    cache.clear()
    genByRoot.clear()
    return
  }
  const key = root.replace(/\/$/, '')
  cache.delete(key)
  genByRoot.set(key, mapGeneration)
}

function scorePath(p: string): number {
  const n = p.replace(/\\/g, '/')
  if (n.includes('/src/')) return 0
  if (/\/(lib|app|packages|server|client)\//.test(n)) return 1
  if (/\/(test|__tests__|spec)\//.test(n)) return 4
  if (SOURCE_EXT.test(n)) return 2
  return 3
}

function extractSymbols(content: string, max: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string): void => {
    if (!name || seen.has(name) || name.length > 64) return
    if (/^(if|for|while|switch|return|from|import|export|const|let|var|function|class|type|interface)$/.test(name))
      return
    seen.add(name)
    out.push(name)
  }

  DEF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DEF_RE.exec(content)) !== null) {
    push(m[1])
    if (out.length >= max) return out
  }
  for (const re of EXTRA_RE) {
    re.lastIndex = 0
    while ((m = re.exec(content)) !== null) {
      push(m[1])
      if (out.length >= max) return out
    }
  }
  return out
}

/** Cheap fingerprint: file count + path list hash of top paths + mtimes when available. */
function fingerprintWalk(
  files: Array<{ path: string; mtimeMs?: number }>,
  gen: number
): string {
  const sample = files
    .slice(0, 120)
    .map((f) => `${f.path}:${Math.floor(f.mtimeMs || 0)}`)
    .join('|')
  let h = 2166136261 >>> 0
  const s = `${gen}:${files.length}:${sample}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
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

  // Higher defaults than before (still capped for prompt size).
  const maxFiles = Math.min(Math.max(opts.maxFiles ?? 120, 10), 300)
  const maxSym = Math.min(Math.max(opts.maxSymbolsPerFile ?? 12, 1), 30)
  const maxChars = Math.min(Math.max(opts.maxChars ?? 16_000, 2000), 48_000)

  const walk = await window.api.fs.walk(root)
  if (!Array.isArray(walk)) {
    return {
      text: `repo_map failed: ${(walk as { error?: string }).error || 'walk error'}`,
      fileCount: 0,
      fromCache: false
    }
  }

  let files = walk.filter((f) => {
    if (f.isDirectory) return false
    const p = f.path.replace(/\\/g, '/')
    if (SKIP.test(p)) return false
    return SOURCE_EXT.test(p)
  })
  files = files.sort(
    (a, b) => scorePath(a.path) - scorePath(b.path) || a.path.length - b.path.length
  )

  const gen = genByRoot.get(root) ?? 0
  const fp = fingerprintWalk(
    files.map((f) => ({
      path: f.path,
      mtimeMs: typeof (f as { mtimeMs?: number }).mtimeMs === 'number'
        ? (f as { mtimeMs?: number }).mtimeMs
        : undefined
    })),
    gen
  )

  const hit = cache.get(root)
  if (
    !opts.force &&
    hit &&
    hit.fingerprint === fp &&
    Date.now() - hit.at < CACHE_TTL_MS
  ) {
    return { text: hit.text, fileCount: hit.fileCount, fromCache: true }
  }

  const selected = files.slice(0, maxFiles)
  const rootNorm = (root.endsWith('/') ? root : root + '/').replace(/\\/g, '/')
  const reads = await window.api.fs.readFiles(selected.map((f) => f.path))

  const lines: string[] = [
    `# Repository map`,
    `root: ${root}`,
    `source_files_scanned: ${selected.length} / ${files.length}`,
    `fingerprint: ${fp}`,
    ``
  ]

  // Group by top-level dir for readability
  const byDir = new Map<string, string[]>()
  for (const item of reads) {
    if (typeof item.content !== 'string') continue
    let rel = item.path.replace(/\\/g, '/')
    if (rel.startsWith(rootNorm)) rel = rel.slice(rootNorm.length)
    const syms = extractSymbols(item.content, maxSym)
    const line = syms.length ? `${rel}: ${syms.join(', ')}` : rel
    const top = rel.split('/')[0] || '.'
    const arr = byDir.get(top) || []
    arr.push(line)
    byDir.set(top, arr)
  }
  for (const [dir, dirLines] of byDir) {
    lines.push(`## ${dir}/`)
    lines.push(...dirLines)
    lines.push('')
  }

  let text = lines.join('\n')
  if (text.length > maxChars) {
    text =
      text.slice(0, maxChars) +
      `\n…(truncated; call repo_map with max_files or use codebase_search)`
  }

  cache.set(root, {
    at: Date.now(),
    text,
    fileCount: selected.length,
    fingerprint: fp
  })
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
