/**
 * Lightweight public web search (DuckDuckGo HTML + HN Algolia + Wikipedia).
 * No API keys. Used by the web_search agent tool.
 */
import { httpGet } from './transport'

export interface SearchHit {
  title: string
  url: string
  snippet?: string
  source: 'duckduckgo' | 'hackernews' | 'wikipedia'
}

export interface WebSearchResult {
  query: string
  hits: SearchHit[]
  text: string
}

function uniqueByUrl(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const h of hits) {
    try {
      const u = new URL(h.url).href
      if (seen.has(u)) continue
      seen.add(u)
      out.push({ ...h, url: u })
    } catch {
      /* skip */
    }
  }
  return out
}

async function ddg(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const { resp } = await httpGet(u, {
    identity: 'chrome',
    timeoutMs,
    refererStrategy: 'none',
    accept: 'text/html'
  })
  if (!resp || resp.status !== 200) return []
  const hits: SearchHit[] = []
  // result blocks
  const blockRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(resp.text)) !== null) {
    let href = m[1]
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (href.includes('uddg=')) {
      const um = /uddg=([^&"]+)/.exec(href)
      if (um) {
        try {
          href = decodeURIComponent(um[1])
        } catch {
          /* keep */
        }
      }
    }
    if (!href.startsWith('http') || href.includes('duckduckgo.com')) continue
    hits.push({ title: title || href, url: href, source: 'duckduckgo' })
    if (hits.length >= 12) break
  }
  // snippets
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  const snips: string[] = []
  while ((m = snipRe.exec(resp.text)) !== null) {
    snips.push(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  }
  hits.forEach((h, i) => {
    if (snips[i]) h.snippet = snips[i]
  })
  return hits
}

async function hn(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8`
  const { resp } = await httpGet(u, { identity: 'chrome', timeoutMs, accept: 'application/json' })
  if (!resp || resp.status !== 200) return []
  try {
    const data = JSON.parse(resp.text) as {
      hits?: Array<{ title?: string; url?: string; objectID?: string; story_text?: string }>
    }
    return (data.hits || []).map((h) => ({
      title: h.title || '(untitled)',
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: h.story_text ? String(h.story_text).slice(0, 200) : undefined,
      source: 'hackernews' as const
    }))
  } catch {
    return []
  }
}

async function wiki(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`
  const { resp } = await httpGet(u, { identity: 'chrome', timeoutMs, accept: 'application/json' })
  if (!resp || resp.status !== 200) return []
  try {
    const data = JSON.parse(resp.text) as [string, string[], string[], string[]]
    const titles = data[1] || []
    const descs = data[2] || []
    const links = data[3] || []
    return titles.map((t, i) => ({
      title: t,
      url: links[i],
      snippet: descs[i],
      source: 'wikipedia' as const
    }))
  } catch {
    return []
  }
}

export async function webSearch(
  query: string,
  opts: { maxResults?: number; timeoutMs?: number; includeHn?: boolean; includeWiki?: boolean } = {}
): Promise<WebSearchResult> {
  const q = query.trim()
  if (!q) return { query: '', hits: [], text: 'query is required' }
  const maxResults = Math.min(Math.max(opts.maxResults ?? 10, 1), 20)
  const timeoutMs = opts.timeoutMs ?? 15_000
  const includeHn = opts.includeHn !== false
  const includeWiki = opts.includeWiki !== false

  const [dHits, hHits, wHits] = await Promise.all([
    ddg(q, timeoutMs).catch(() => [] as SearchHit[]),
    includeHn ? hn(q, timeoutMs).catch(() => [] as SearchHit[]) : Promise.resolve([] as SearchHit[]),
    includeWiki ? wiki(q, timeoutMs).catch(() => [] as SearchHit[]) : Promise.resolve([] as SearchHit[])
  ])

  // Prefer wiki + hn first for quality, then DDG
  const hits = uniqueByUrl([...wHits, ...hHits, ...dHits]).slice(0, maxResults)
  const lines = [
    `# Web search: ${q}`,
    `results=${hits.length}`,
    '',
    ...hits.map((h, i) => {
      return [
        `${i + 1}. [${h.source}] ${h.title}`,
        `   ${h.url}`,
        h.snippet ? `   ${h.snippet}` : null
      ]
        .filter(Boolean)
        .join('\n')
    })
  ]
  if (!hits.length) {
    lines.push('No results. Try a different query, or web_fetch a known URL.')
  }
  return { query: q, hits, text: lines.join('\n') }
}
