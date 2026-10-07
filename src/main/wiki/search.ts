import { loadWiki } from './pages'
import type { WikiPage, WikiScope, WikiSearchHit } from './types'

interface SearchOpts {
  query: string
  scope?: WikiScope | 'all'
  projectId: string | null
  limit?: number
}

function scopesOf(scope: WikiScope | 'all' | undefined, projectId: string | null): Array<{ scope: WikiScope; projectId: string | null }> {
  if (scope === 'user') return [{ scope: 'user', projectId: null }]
  if (scope === 'project' && projectId) return [{ scope: 'project', projectId }]
  const out: Array<{ scope: WikiScope; projectId: string | null }> = []
  if (projectId) out.push({ scope: 'project', projectId })
  out.push({ scope: 'user', projectId: null })
  return out
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12)
}

function snippetAround(body: string, needle: string, radius = 70): string {
  const idx = body.toLowerCase().indexOf(needle)
  if (idx < 0) {
    const head = body.slice(0, radius * 2).replace(/\s+/g, ' ').trim()
    return head
  }
  const start = Math.max(0, idx - radius)
  const end = Math.min(body.length, idx + needle.length + radius)
  const text = body.slice(start, end).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '…' : '') + text + (end < body.length ? '…' : '')
}

function scorePage(p: WikiPage, query: string, tokens: string[]): { score: number; snippet: string } {
  const title = p.title.toLowerCase()
  const summary = p.summary.toLowerCase()
  const tags = p.tags.join(' ').toLowerCase()
  const body = p.body.toLowerCase()
  let score = 0
  let snippet = ''

  if (query && title.includes(query)) score += 3
  const titleTokenHits = tokens.filter((t) => title.includes(t)).length
  if (tokens.length) score += 2 * (titleTokenHits / tokens.length)
  if (query && tags.includes(query)) score += 2
  score += 1.2 * (tokens.filter((t) => tags.includes(t)).length / Math.max(tokens.length, 1))
  if (query && summary.includes(query)) score += 1.5
  score += 0.8 * (tokens.filter((t) => summary.includes(t)).length / Math.max(tokens.length, 1))

  let bodyHits = 0
  for (const t of tokens) {
    if (body.includes(t)) {
      bodyHits += 1
      if (!snippet) snippet = snippetAround(p.body, t)
    }
  }
  if (tokens.length) score += Math.min(2, bodyHits * 0.5)

  // Link-graph popularity and freshness help ties break sensibly.
  score += 0.5 * (Math.min(p.backlinks, 4) / 4)
  const ageDays = (Date.now() - Date.parse(p.updated || '')) / 86_400_000
  if (Number.isFinite(ageDays)) score += 0.5 * Math.max(0, 1 - ageDays / 120)

  if (!snippet) snippet = snippetAround(p.body, query || tokens[0] || '')
  return { score: Math.round(score * 1000) / 1000, snippet }
}

/** Token search over both wikis (project first) unless a single scope is requested. */
export function searchPages(opts: SearchOpts): WikiSearchHit[] {
  const query = (opts.query || '').trim()
  const tokens = tokenize(query)
  if (!query) return []
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50)
  const hits: WikiSearchHit[] = []
  for (const s of scopesOf(opts.scope, opts.projectId)) {
    for (const p of loadWiki(s.scope, s.projectId)) {
      const { score, snippet } = scorePage(p, query.toLowerCase(), tokens)
      if (score <= 0.4) continue
      const { body: _body, ...meta } = p
      hits.push({ ...meta, scope: s.scope, score, snippet })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
