/**
 * Higher-level multi-source research: discover URLs (DDG HTML lite, HN Algolia,
 * Wikipedia) then fetch each with the adaptive chain.
 */
import { fetchUrl, formatFetchForAgent } from './fetchChain'
import { httpGet } from './transport'
import type { FetchOptions, FetchResult } from './types'
import { DEFAULT_MAX_CONTENT } from './types'

export interface ResearchOptions extends FetchOptions {
  query: string
  urls?: string[]
  maxSources?: number
  includeSearch?: boolean
}

export interface ResearchSource {
  url: string
  title?: string
  ok: boolean
  summary: string
  content: string
  verdict: string
  platform?: string
}

export interface ResearchResult {
  query: string
  sources: ResearchSource[]
  discoveredUrls: string[]
  text: string
}

async function searchDuckDuckGo(query: string, timeoutMs: number): Promise<string[]> {
  const u = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const { resp } = await httpGet(u, {
    identity: 'chrome',
    timeoutMs,
    refererStrategy: 'none',
    accept: 'text/html'
  })
  if (!resp || resp.status !== 200) return []
  // DDG html lite uses uddg= redirect links
  const urls: string[] = []
  const re = /uddg=([^&"]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(resp.text))) {
    try {
      const decoded = decodeURIComponent(m[1])
      if (decoded.startsWith('http') && !decoded.includes('duckduckgo.com')) {
        if (!urls.includes(decoded)) urls.push(decoded)
      }
    } catch {
      /* skip */
    }
  }
  // also plain hrefs
  const hrefRe = /href="(https?:\/\/[^"]+)"/g
  while ((m = hrefRe.exec(resp.text))) {
    const href = m[1]
    if (
      !href.includes('duckduckgo.com') &&
      !href.includes('duck.com') &&
      href.startsWith('http') &&
      !urls.includes(href)
    ) {
      urls.push(href)
    }
  }
  return urls.slice(0, 15)
}

async function searchHnAlgolia(query: string, timeoutMs: number): Promise<string[]> {
  const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8`
  const { resp } = await httpGet(u, {
    identity: 'chrome',
    timeoutMs,
    accept: 'application/json'
  })
  if (!resp || resp.status !== 200) return []
  try {
    const data = JSON.parse(resp.text) as {
      hits?: Array<{ url?: string; objectID?: string; title?: string }>
    }
    const urls: string[] = []
    for (const h of data.hits || []) {
      if (h.url) urls.push(h.url)
      else if (h.objectID) urls.push(`https://news.ycombinator.com/item?id=${h.objectID}`)
    }
    return urls
  } catch {
    return []
  }
}

async function searchWikipedia(query: string, timeoutMs: number): Promise<string[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json`
  const { resp } = await httpGet(u, {
    identity: 'chrome',
    timeoutMs,
    accept: 'application/json'
  })
  if (!resp || resp.status !== 200) return []
  try {
    const data = JSON.parse(resp.text) as unknown[]
    const links = (data[3] as string[]) || []
    return links.filter((x) => typeof x === 'string')
  } catch {
    return []
  }
}

function uniqueUrls(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of list) {
    try {
      const n = new URL(u).href
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
    } catch {
      /* skip */
    }
  }
  return out
}

/**
 * Research a topic: discover public sources then fetch each adaptively.
 */
export async function researchTopic(options: ResearchOptions): Promise<ResearchResult> {
  const query = (options.query || '').trim()
  const maxSources = Math.min(Math.max(options.maxSources ?? 5, 1), 12)
  const timeoutMs = options.timeoutMs ?? 18_000
  const includeSearch = options.includeSearch !== false
  const seed = options.urls || []

  const discovered: string[] = [...seed]
  if (includeSearch && query) {
    const [ddg, hn, wiki] = await Promise.all([
      searchDuckDuckGo(query, timeoutMs).catch(() => [] as string[]),
      searchHnAlgolia(query, timeoutMs).catch(() => [] as string[]),
      searchWikipedia(query, timeoutMs).catch(() => [] as string[])
    ])
    discovered.push(...wiki, ...hn, ...ddg)
  }

  const targets = uniqueUrls(discovered).slice(0, maxSources)
  const fetchOpts: FetchOptions = {
    timeoutMs,
    maxAttempts: options.maxAttempts ?? 8,
    enablePhase0: options.enablePhase0,
    enableJina: options.enableJina,
    enableExtraction: options.enableExtraction,
    maxContentChars: options.maxContentChars ?? Math.min(DEFAULT_MAX_CONTENT, 40_000)
  }

  const sources: ResearchSource[] = []
  // sequential to be polite / reuse less risk of rate limits
  for (const url of targets) {
    let result: FetchResult
    try {
      result = await fetchUrl(url, fetchOpts)
    } catch (e) {
      sources.push({
        url,
        ok: false,
        summary: e instanceof Error ? e.message : String(e),
        content: '',
        verdict: 'error'
      })
      continue
    }
    sources.push({
      url: result.finalUrl || url,
      title: result.title,
      ok: result.ok,
      summary: result.summary,
      content: result.content.slice(0, fetchOpts.maxContentChars || 40_000),
      verdict: result.verdict,
      platform: result.platform
    })
  }

  const text = formatResearchForAgent(query, sources, uniqueUrls(discovered))
  return { query, sources, discoveredUrls: uniqueUrls(discovered), text }
}

export function formatResearchForAgent(
  query: string,
  sources: ResearchSource[],
  discovered: string[]
): string {
  const lines: string[] = []
  lines.push(`# Research: ${query || '(urls only)'}`)
  lines.push(`sources_fetched=${sources.length} ok=${sources.filter((s) => s.ok).length}`)
  if (discovered.length) {
    lines.push(`discovered_urls=${discovered.length}`)
  }
  lines.push('')
  sources.forEach((s, i) => {
    lines.push(`--- Source ${i + 1}: ${s.ok ? 'OK' : 'FAIL'} ---`)
    lines.push(`url: ${s.url}`)
    if (s.title) lines.push(`title: ${s.title}`)
    if (s.platform) lines.push(`platform: ${s.platform}`)
    lines.push(`verdict: ${s.verdict}`)
    lines.push(`summary: ${s.summary}`)
    lines.push('')
    lines.push('[BEGIN UNTRUSTED WEB CONTENT]')
    lines.push(s.content || '(empty)')
    lines.push('[END UNTRUSTED WEB CONTENT]')
    lines.push('')
  })
  if (!sources.length) {
    lines.push('No sources could be discovered or fetched. Try providing explicit urls[], or a more specific query.')
  }
  return lines.join('\n')
}

/** Single-URL tool helper re-export. */
export { fetchUrl, formatFetchForAgent }
