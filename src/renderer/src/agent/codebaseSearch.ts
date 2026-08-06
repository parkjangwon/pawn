/**
 * Symbol-aware local codebase search (no network, no paid index).
 * Fast path: main-process rg / git-grep. Fallback: walk + readFiles.
 */

const SOURCE_EXT =
  /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|vue|svelte|c|cc|cpp|h|hpp|cs|scala|clj|ex|exs|ml|mli|zig|sh)$/i

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|out|build|coverage|\.next|target|vendor)(\/|$)/i

function compileGlob(pattern: string): RegExp | null {
  const regexStr = pattern
    .replace(/\*{2,}/g, '__GLOBSTAR__')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '[^/]')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*')
  try {
    return new RegExp(`^${regexStr}$`, 'i')
  } catch {
    return null
  }
}

function matchesGlob(name: string, pattern: string, compiled?: RegExp | null): boolean {
  const re = compiled !== undefined ? compiled : compileGlob(pattern)
  if (re) return re.test(name)
  return name.toLowerCase().includes(pattern.toLowerCase())
}

function definitionPatterns(query: string): RegExp[] {
  const q = query.trim()
  if (!q) return []
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const id = esc.includes(' ') ? esc.replace(/\s+/g, '.*?') : esc
  return [
    new RegExp(
      `\\b(function|class|interface|type|enum|const|let|var|def|fn|struct|impl|trait|module|namespace|export\\s+(?:async\\s+)?function|export\\s+class|export\\s+interface|export\\s+type|export\\s+const)\\s+${id}\\b`,
      'i'
    ),
    new RegExp(`\\b${id}\\s*[=:(]`, 'i'),
    new RegExp(`\\b${id}\\b`, 'i')
  ]
}

type Hit = { path: string; line: number; text: string; rank: number }

function rankLine(line: string, patterns: RegExp[]): number {
  if (line.length > 400) return -1
  for (let pi = 0; pi < patterns.length; pi++) {
    patterns[pi].lastIndex = 0
    if (patterns[pi].test(line)) return pi
  }
  return -1
}

function formatHits(q: string, unique: Hit[], engine: string): string {
  const defs = unique.filter((h) => h.rank === 0)
  const rest = unique.filter((h) => h.rank !== 0)
  const lines: string[] = [
    `# codebase_search: ${q}`,
    `engine=${engine} matches=${unique.length} (definition-like=${defs.length})`,
    ''
  ]
  if (defs.length) {
    lines.push('## Likely definitions')
    for (const h of defs) lines.push(`${h.path}:${h.line}: ${h.text}`)
    lines.push('')
  }
  if (rest.length) {
    lines.push('## Other references')
    for (const h of rest) lines.push(`${h.path}:${h.line}: ${h.text}`)
  }
  return lines.join('\n')
}

function dedupeHits(hits: Hit[], maxResults: number): Hit[] {
  hits.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path) || a.line - b.line)
  const seen = new Set<string>()
  const unique: Hit[] = []
  for (const h of hits) {
    const k = `${h.path}:${h.line}`
    if (seen.has(k)) continue
    seen.add(k)
    unique.push(h)
    if (unique.length >= maxResults) break
  }
  return unique
}

/** Fast path via main-process contentSearch (rg / git-grep). */
async function searchFast(
  root: string,
  q: string,
  patterns: RegExp[],
  maxResults: number,
  pathGlob?: string
): Promise<{ hits: Hit[]; engine: string } | null> {
  const api = window.api?.fs?.contentSearch
  if (!api) return null
  try {
    const res = await api(root, {
      query: q,
      fixedString: true,
      caseInsensitive: false,
      glob: pathGlob,
      maxMatches: Math.min(maxResults * 3, 120),
      timeoutMs: 12_000
    })
    if (!res || res.engine === 'none') return null
    if (res.error && res.matches.length === 0) return null
    const hits: Hit[] = []
    for (const m of res.matches) {
      const rank = rankLine(m.text, patterns)
      if (rank < 0) continue
      hits.push({
        path: m.path,
        line: m.line,
        text: m.text.trim().slice(0, 200),
        rank
      })
    }
    // If fixed-string search found lines but rank filter emptied (weird id),
    // still return unranked refs so the agent gets something.
    if (!hits.length && res.matches.length) {
      for (const m of res.matches.slice(0, maxResults)) {
        hits.push({
          path: m.path,
          line: m.line,
          text: m.text.trim().slice(0, 200),
          rank: 2
        })
      }
    }
    return { hits, engine: res.engine }
  } catch {
    return null
  }
}

/** Legacy walk + bulk read (dev:web / no rg / no git). */
async function searchWalk(
  root: string,
  q: string,
  patterns: RegExp[],
  maxResults: number,
  pathGlob?: string
): Promise<{ hits: Hit[]; engine: string }> {
  const walk = await window.api.fs.walk(root)
  if (!Array.isArray(walk)) {
    return { hits: [], engine: 'walk' }
  }

  const rootNorm = (root.endsWith('/') ? root : root + '/').replace(/\\/g, '/')
  const compiled = pathGlob ? compileGlob(pathGlob) : null

  let files = walk.filter((f) => {
    if (f.isDirectory) return false
    const p = f.path.replace(/\\/g, '/')
    if (SKIP_DIR.test(p)) return false
    if (!SOURCE_EXT.test(p) && !pathGlob) return false
    if (pathGlob) {
      const rel = p.startsWith(rootNorm) ? p.slice(rootNorm.length) : f.name
      return matchesGlob(rel, pathGlob, compiled) || matchesGlob(f.name, pathGlob, compiled)
    }
    return true
  })

  files = files.sort((a, b) => {
    const score = (p: string): number => {
      if (p.includes('/src/')) return 0
      if (SOURCE_EXT.test(p)) return 1
      return 2
    }
    return score(a.path) - score(b.path) || a.path.length - b.path.length
  })

  const hits: Hit[] = []
  const reads = await window.api.fs.readFiles(files.slice(0, 500).map((f) => f.path))

  for (const item of reads) {
    if (hits.length >= maxResults * 2) break
    if (typeof item.content !== 'string') continue
    const lines = item.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const rank = rankLine(line, patterns)
      if (rank < 0) continue
      hits.push({
        path: item.path,
        line: i + 1,
        text: line.trim().slice(0, 200),
        rank
      })
      if (hits.length >= maxResults * 3) break
    }
  }
  return { hits, engine: 'walk' }
}

export async function searchCodebase(
  projectPath: string,
  query: string,
  opts: { maxResults?: number; pathGlob?: string } = {}
): Promise<string> {
  const q = query.trim()
  if (!q) return 'query is required'
  const maxResults = Math.min(Math.max(opts.maxResults ?? 40, 1), 100)
  const root = projectPath.replace(/\/$/, '')
  const patterns = definitionPatterns(q)

  const fast = await searchFast(root, q, patterns, maxResults, opts.pathGlob)
  const { hits, engine } = fast ?? (await searchWalk(root, q, patterns, maxResults, opts.pathGlob))
  const unique = dedupeHits(hits, maxResults)

  if (!unique.length) {
    return `No codebase matches for ${JSON.stringify(q)} under ${root}. Try grep_search for a looser pattern.`
  }

  return formatHits(q, unique, engine)
}
