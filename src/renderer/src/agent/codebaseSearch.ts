/**
 * Symbol-aware local codebase search (no network).
 * Combines definition-like patterns + text matches across source files.
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
  // whole identifier-ish
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

export async function searchCodebase(
  projectPath: string,
  query: string,
  opts: { maxResults?: number; pathGlob?: string } = {}
): Promise<string> {
  const q = query.trim()
  if (!q) return 'query is required'
  const maxResults = Math.min(Math.max(opts.maxResults ?? 40, 1), 100)
  const root = projectPath.replace(/\/$/, '')
  const walk = await window.api.fs.walk(root)
  if (!Array.isArray(walk)) {
    return (walk as { error: string }).error || 'walk failed'
  }

  const rootNorm = (root.endsWith('/') ? root : root + '/').replace(/\\/g, '/')
  const compiled = opts.pathGlob ? compileGlob(opts.pathGlob) : null

  let files = walk.filter((f) => {
    if (f.isDirectory) return false
    const p = f.path.replace(/\\/g, '/')
    if (SKIP_DIR.test(p)) return false
    if (!SOURCE_EXT.test(p) && !opts.pathGlob) return false
    if (opts.pathGlob) {
      const rel = p.startsWith(rootNorm) ? p.slice(rootNorm.length) : f.name
      return matchesGlob(rel, opts.pathGlob, compiled) || matchesGlob(f.name, opts.pathGlob, compiled)
    }
    return true
  })

  // Prefer shorter paths / src
  files = files.sort((a, b) => {
    const score = (p: string): number => {
      if (p.includes('/src/')) return 0
      if (SOURCE_EXT.test(p)) return 1
      return 2
    }
    return score(a.path) - score(b.path) || a.path.length - b.path.length
  })

  const patterns = definitionPatterns(q)
  type Hit = { path: string; line: number; text: string; rank: number }
  const hits: Hit[] = []
  const reads = await window.api.fs.readFiles(files.slice(0, 500).map((f) => f.path))

  for (const item of reads) {
    if (hits.length >= maxResults * 2) break
    if (typeof item.content !== 'string') continue
    const lines = item.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 400) continue
      let rank = -1
      for (let pi = 0; pi < patterns.length; pi++) {
        patterns[pi].lastIndex = 0
        if (patterns[pi].test(line)) {
          rank = pi // 0 = strong def, higher = weaker
          break
        }
      }
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

  hits.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path) || a.line - b.line)

  // Dedupe path:line
  const seen = new Set<string>()
  const unique: Hit[] = []
  for (const h of hits) {
    const k = `${h.path}:${h.line}`
    if (seen.has(k)) continue
    seen.add(k)
    unique.push(h)
    if (unique.length >= maxResults) break
  }

  if (!unique.length) {
    return `No codebase matches for ${JSON.stringify(q)} under ${root}. Try grep_search for a looser pattern.`
  }

  const defs = unique.filter((h) => h.rank === 0)
  const rest = unique.filter((h) => h.rank !== 0)
  const lines: string[] = [
    `# codebase_search: ${q}`,
    `matches=${unique.length} (definition-like=${defs.length})`,
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
