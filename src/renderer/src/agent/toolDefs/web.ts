import type { ToolDefinition } from '../toolDefinitionsTypes'

export const WEB_TOOLS: ToolDefinition[] = [
  {
    name: 'web_fetch',
    description:
      'Fetch a public web page or API URL with an adaptive reader (Phase 0 platform APIs → header/identity grid → Jina Reader). Prefer this over shell curl and over browser_* for reading public articles, docs, Reddit/X/HN/YouTube/Wikipedia/arXiv/GitHub public pages, or when a plain fetch is blocked. Returns extracted text wrapped as untrusted content. Not a login/paywall bypass. If must_invoke_browser is set, escalate with browser_navigate + browser_read_text.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch (http/https). Bare domains get https://.' },
        max_attempts: {
          type: 'number',
          description: 'Max HTTP grid attempts (default 12). Lower for quick probes.'
        },
        device_class: {
          type: 'string',
          description: 'auto | desktop | mobile (default auto)'
        },
        include_trace: {
          type: 'boolean',
          description: 'Include attempt trace for debugging (default false)'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'web_research',
    description:
      'Multi-source public research for a topic: discovers URLs (DuckDuckGo HTML, HN Algolia, Wikipedia) and/or uses seed urls, then fetches each with web_fetch. Use when the user asks to research, investigate, survey opinions, find sources, or gather material on a topic — do not invent citations; call this (or web_fetch) first. Returns combined untrusted excerpts from public sources only.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Research topic / search query (optional if urls are provided)'
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional seed URLs to fetch in addition to discovered sources'
        },
        max_sources: {
          type: 'number',
          description: 'Max pages to fetch (default 5, max 12)'
        },
        include_search: {
          type: 'boolean',
          description: 'Discover URLs via public search (default true when query is set)'
        }
      },
      required: []
    }
  },
  {
    name: 'web_search',
    description:
      'Search the public web (DuckDuckGo HTML + Hacker News + Wikipedia). Returns titles, URLs, snippets — not full page text. Prefer web_search to discover URLs, then web_fetch for content. Faster and cheaper than web_research when you only need links.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Max results (default 10, max 20)' }
      },
      required: ['query']
    }
  }
]
