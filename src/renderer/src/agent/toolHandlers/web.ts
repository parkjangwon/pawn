import type { ToolHandler } from './types'


const web_fetch: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.research?.fetch) {
          return {
            toolCallId: call.id,
            content: 'Research tools are only available in the desktop app.',
            isError: true
          }
        }
        const url = String(call.arguments.url || '').trim()
        if (!url) {
          return { toolCallId: call.id, content: 'url is required', isError: true }
        }
        const res = await api.research.fetch(url, {
          maxAttempts:
            call.arguments.max_attempts !== undefined ? Number(call.arguments.max_attempts) : undefined,
          deviceClass: (['auto', 'desktop', 'mobile'].includes(String(call.arguments.device_class))
            ? String(call.arguments.device_class)
            : 'auto') as 'auto' | 'desktop' | 'mobile',
          includeTrace: call.arguments.include_trace === true
        })
        return {
          toolCallId: call.id,
          content: res.text || res.error || 'Empty research response',
          isError: !res.ok && !res.text
        }
      }


const web_research: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.research?.research) {
          return {
            toolCallId: call.id,
            content: 'Research tools are only available in the desktop app.',
            isError: true
          }
        }
        const query = call.arguments.query !== undefined ? String(call.arguments.query) : ''
        const urls = Array.isArray(call.arguments.urls)
          ? (call.arguments.urls as unknown[]).map(String)
          : undefined
        if (!query.trim() && (!urls || !urls.length)) {
          return {
            toolCallId: call.id,
            content: 'Provide query and/or urls for web_research.',
            isError: true
          }
        }
        const res = await api.research.research({
          query: query.trim() || undefined,
          urls,
          maxSources:
            call.arguments.max_sources !== undefined ? Number(call.arguments.max_sources) : undefined,
          includeSearch:
            call.arguments.include_search !== undefined
              ? call.arguments.include_search === true
              : undefined
        })
        return {
          toolCallId: call.id,
          content: res.text || res.error || 'Empty research response',
          isError: !res.ok && !res.text
        }
      }


const web_search: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.research?.search) {
          return {
            toolCallId: call.id,
            content: 'Web search is only available in the desktop app.',
            isError: true
          }
        }
        const q = String(call.arguments.query || '').trim()
        if (!q) return { toolCallId: call.id, content: 'query is required', isError: true }
        const res = await api.research.search({
          query: q,
          maxResults:
            call.arguments.max_results !== undefined ? Number(call.arguments.max_results) : undefined
        })
        return {
          toolCallId: call.id,
          content: res.text || res.error || 'Empty search response',
          isError: !res.ok && !res.text
        }
      }


export const webHandlers: Record<string, ToolHandler> = {
  'web_fetch': web_fetch,
  'web_research': web_research,
  'web_search': web_search,
}
