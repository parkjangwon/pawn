/**
 * Lightweight public web search (no paid API keys required).
 * Sources: DuckDuckGo HTML, Bing HTML, Wikipedia (en + ko), Hacker News.
 * Optional: BRAVE_API_KEY / PAWN_BRAVE_API_KEY for Brave Search API.
 */
import { httpGet } from './transport'

export interface SearchHit {
  title: string
  url: string
  snippet?: string
  source: 'duckduckgo' | 'bing' | 'hackernews' | 'wikipedia' | 'brave' | 'wikipedia-ko'
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

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  const blockRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(resp.text)) !== null) {
    let href = m[1]
    const title = decodeHtml(m[2])
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
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  const snips: string[] = []
  while ((m = snipRe.exec(resp.text)) !== null) {
    snips.push(decodeHtml(m[1]))
  }
  hits.forEach((h, i) => {
    if (snips[i]) h.snippet = snips[i]
  })
  return hits
}

/** Bing HTML results page (no API key). Best-effort parser. */
async function bing(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const u = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`
  const { resp } = await httpGet(u, {
    identity: 'chrome',
    timeoutMs,
    refererStrategy: 'none',
    accept: 'text/html'
  })
  if (!resp || resp.status !== 200) return []
  const hits: SearchHit[] = []
  // li.b_algo h2 > a
  const re = /<li class="b_algo"[\s\S]*?<h2>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(resp.text)) !== null) {
    const href = m[1]
    const title = decodeHtml(m[2])
    if (!href || href.includes('bing.com') || href.includes('microsoft.com/')) continue
    hits.push({ title: title || href, url: href, source: 'bing' })
    if (hits.length >= 10) break
  }
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

async function wikiLang(
  query: string,
  lang: 'en' | 'ko',
  timeoutMs: number
): Promise<SearchHit[]> {
  const host = lang === 'ko' ? 'ko.wikipedia.org' : 'en.wikipedia.org'
  const u = `https://${host}/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`
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
      source: (lang === 'ko' ? 'wikipedia-ko' : 'wikipedia') as SearchHit['source']
    }))
  } catch {
    return []
  }
}

async function brave(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const key =
    process.env.PAWN_BRAVE_API_KEY ||
    process.env.BRAVE_API_KEY ||
    process.env.BRAVE_SEARCH_API_KEY
  if (!key) return []
  const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(u, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key
      },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!res.ok) return []
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
    }
    return (data.web?.results || []).map((r) => ({
      title: r.title || r.url || '(untitled)',
      url: r.url || '',
      snippet: r.description,
      source: 'brave' as const
    })).filter((h) => h.url)
  } catch {
    return []
  }
}

function looksKorean(q: string): boolean {
  return /[\uac00-\ud7a3]/.test(q)
}

export async function webSearch(
  query: string,
  opts: {
    maxResults?: number
    timeoutMs?: number
    includeHn?: boolean
    includeWiki?: boolean
    includeBing?: boolean
  } = {}
): Promise<WebSearchResult> {
  const q = query.trim()
  if (!q) return { query: '', hits: [], text: 'query is required' }
  const maxResults = Math.min(Math.max(opts.maxResults ?? 12, 1), 25)
  const timeoutMs = opts.timeoutMs ?? 15_000
  const includeHn = opts.includeHn !== false
  const includeWiki = opts.includeWiki !== false
  const includeBing = opts.includeBing !== false
  const ko = looksKorean(q)

  const tasks: Array<Promise<SearchHit[]>> = [
    ddg(q, timeoutMs).catch(() => [] as SearchHit[]),
    brave(q, timeoutMs).catch(() => [] as SearchHit[])
  ]
  if (includeBing) tasks.push(bing(q, timeoutMs).catch(() => [] as SearchHit[]))
  if (includeHn) tasks.push(hn(q, timeoutMs).catch(() => [] as SearchHit[]))
  if (includeWiki) {
    tasks.push(wikiLang(q, 'en', timeoutMs).catch(() => [] as SearchHit[]))
    if (ko) tasks.push(wikiLang(q, 'ko', timeoutMs).catch(() => [] as SearchHit[]))
  }

  const batches = await Promise.all(tasks)
  const [dHits, bHits, ...rest] = batches
  // Prefer Brave + wiki + HN quality, then Bing + DDG
  const ordered = uniqueByUrl([
    ...(bHits || []),
    ...rest.flat(),
    ...(dHits || [])
  ]).slice(0, maxResults)

  const lines = [
    `# Web search: ${q}`,
    `results=${ordered.length}`,
    `sources=ddg,bing,wiki${ko ? '+ko' : ''},hn,brave(optional)`,
    '',
    ...ordered.map((h, i) => {
      return [
        `${i + 1}. [${h.source}] ${h.title}`,
        `   ${h.url}`,
        h.snippet ? `   ${h.snippet}` : null
      ]
        .filter(Boolean)
        .join('\n')
    })
  ]
  if (!ordered.length) {
    lines.push('No results. Try a different query, or web_fetch a known URL.')
  }
  return { query: q, hits: ordered, text: lines.join('\n') }
}
