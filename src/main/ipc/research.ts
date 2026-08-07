import { handleTrusted } from './trust'
import { fetchUrl, formatFetchForAgent, researchTopic, webSearch } from '../research'
import type { FetchOptions } from '../research'

export function registerResearchIpc(): void {
  handleTrusted(
    'research:fetch',
    async (
      _e,
      url: string,
      opts?: {
        timeoutMs?: number
        maxAttempts?: number | null
        enablePhase0?: boolean
        enableJina?: boolean
        deviceClass?: 'auto' | 'desktop' | 'mobile'
        maxContentChars?: number
        includeTrace?: boolean
      }
    ) => {
      try {
        if (!url || typeof url !== 'string') {
          return { ok: false, error: 'url is required', text: '' }
        }
        // Clamp runaway agent opts so one call cannot hang for hours.
        const fetchOpts: FetchOptions = {
          timeoutMs:
            opts?.timeoutMs != null
              ? Math.min(120_000, Math.max(3_000, Math.floor(Number(opts.timeoutMs) || 30_000)))
              : undefined,
          maxAttempts: opts?.maxAttempts,
          enablePhase0: opts?.enablePhase0,
          enableJina: opts?.enableJina,
          deviceClass: opts?.deviceClass,
          maxContentChars:
            opts?.maxContentChars != null
              ? Math.min(200_000, Math.max(1_000, Math.floor(Number(opts.maxContentChars) || 80_000)))
              : undefined
        }
        const result = await fetchUrl(url, fetchOpts)
        const text = formatFetchForAgent(result, { includeTrace: opts?.includeTrace === true })
        return {
          ok: result.ok,
          text,
          error: result.ok ? undefined : result.summary || result.stopReason,
          finalUrl: result.finalUrl,
          verdict: result.verdict,
          mustInvokeBrowser: result.mustInvokeBrowser,
          platform: result.platform,
          title: result.title
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: msg, text: `Research fetch failed: ${msg}` }
      }
    }
  )

  handleTrusted(
    'research:research',
    async (
      _e,
      input: {
        query?: string
        urls?: string[]
        maxSources?: number
        includeSearch?: boolean
        timeoutMs?: number
        maxAttempts?: number
      }
    ) => {
      try {
        const query = (input?.query || '').trim()
        const urls = Array.isArray(input?.urls)
          ? input.urls.filter((u): u is string => typeof u === 'string').slice(0, 12)
          : []
        if (!query && !urls.length) {
          return { ok: false, error: 'query or urls required', text: '' }
        }
        const result = await researchTopic({
          query: query || urls[0] || '',
          urls,
          maxSources: input?.maxSources != null ? Math.min(12, Math.max(1, Math.floor(Number(input.maxSources) || 5))) : undefined,
          includeSearch: input?.includeSearch ?? !!query,
          timeoutMs:
            input?.timeoutMs != null
              ? Math.min(120_000, Math.max(3_000, Math.floor(Number(input.timeoutMs) || 30_000)))
              : undefined,
          maxAttempts: input?.maxAttempts
        })
        return {
          ok: result.sources.some((s) => s.ok),
          text: result.text,
          sourceCount: result.sources.length,
          okCount: result.sources.filter((s) => s.ok).length,
          discoveredUrls: result.discoveredUrls
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: msg, text: `Research failed: ${msg}` }
      }
    }
  )

  handleTrusted(
    'research:search',
    async (
      _e,
      input: {
        query?: string
        maxResults?: number
        timeoutMs?: number
        includeHn?: boolean
        includeWiki?: boolean
      }
    ) => {
      try {
        const query = (input?.query || '').trim()
        if (!query) return { ok: false, error: 'query is required', text: '' }
        const result = await webSearch(query, {
          maxResults:
            input?.maxResults != null
              ? Math.min(30, Math.max(1, Math.floor(Number(input.maxResults) || 8)))
              : undefined,
          timeoutMs:
            input?.timeoutMs != null
              ? Math.min(60_000, Math.max(2_000, Math.floor(Number(input.timeoutMs) || 15_000)))
              : undefined,
          includeHn: input?.includeHn,
          includeWiki: input?.includeWiki
        })
        return {
          ok: result.hits.length > 0,
          text: result.text,
          hitCount: result.hits.length,
          hits: result.hits
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: msg, text: `Web search failed: ${msg}` }
      }
    }
  )
}
