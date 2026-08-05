import { ipcMain } from 'electron'
import { fetchUrl, formatFetchForAgent, researchTopic, webSearch } from '../research'
import type { FetchOptions } from '../research'

export function registerResearchIpc(): void {
  ipcMain.handle(
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
        const fetchOpts: FetchOptions = {
          timeoutMs: opts?.timeoutMs,
          maxAttempts: opts?.maxAttempts,
          enablePhase0: opts?.enablePhase0,
          enableJina: opts?.enableJina,
          deviceClass: opts?.deviceClass,
          maxContentChars: opts?.maxContentChars
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

  ipcMain.handle(
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
        const urls = Array.isArray(input?.urls) ? input.urls.filter((u) => typeof u === 'string') : []
        if (!query && !urls.length) {
          return { ok: false, error: 'query or urls required', text: '' }
        }
        const result = await researchTopic({
          query: query || urls[0] || '',
          urls,
          maxSources: input?.maxSources,
          includeSearch: input?.includeSearch ?? !!query,
          timeoutMs: input?.timeoutMs,
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

  ipcMain.handle(
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
          maxResults: input?.maxResults,
          timeoutMs: input?.timeoutMs,
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
