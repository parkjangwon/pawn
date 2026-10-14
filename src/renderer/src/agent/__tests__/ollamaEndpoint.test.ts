import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DEFAULT_OLLAMA_URL,
  isOllamaProvider,
  migrateOllamaProviders,
  ollamaApiBase,
  validateOllamaUrl
} from '../ollamaEndpoint'
import { fetchProviderModels } from '../listModels'
import { callLLM } from '../llm'
import { useProviderStore } from '../../stores/provider'

const LAN = 'http://192.168.0.10:11434'

describe('validateOllamaUrl', () => {
  it('accepts LAN ip with port, https, and normalizes trailing slash and /v1', () => {
    expect(validateOllamaUrl(` ${LAN}/ `)).toEqual({ ok: true, url: LAN })
    expect(validateOllamaUrl(`${LAN}/v1/`)).toEqual({ ok: true, url: LAN })
    expect(validateOllamaUrl('https://ollama.example.com')).toEqual({ ok: true, url: 'https://ollama.example.com' })
    expect(validateOllamaUrl('http://host/proxy/v1')).toEqual({ ok: true, url: 'http://host/proxy' })
  })

  it.each([
    ['', /Enter/],
    ['192.168.0.10:11434', /http:\/\//],
    ['localhost:11434', /http:\/\//],
    ['ftp://192.168.0.10:11434', /Only http/],
    ['http://:11434', /host/],
    ['http://h:0', /port/],
    ['http://h:99999', /port/],
    ['http://h:abc', /port/],
    ['http://user:pw@h:11434', /username/],
    [`${LAN}?a=1`, /query/],
    [`${LAN}#x`, /query/]
  ])('rejects %j', (input, msg) => {
    const r = validateOllamaUrl(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(msg)
  })
})

describe('migrateOllamaProviders', () => {
  it('fills missing baseUrl on Ollama providers only, idempotently', () => {
    const input = [
      { name: 'Ollama (local)', baseUrl: '' },
      { name: 'My box', baseUrl: 'http://x:11434/v1' },
      { name: 'ollama2' },
      { name: 'OpenAI', baseUrl: '' }
    ]
    const out = migrateOllamaProviders(input)
    expect(out).not.toBe(input)
    expect(out.map((p) => p.baseUrl)).toEqual([ollamaApiBase(DEFAULT_OLLAMA_URL), 'http://x:11434/v1', ollamaApiBase(DEFAULT_OLLAMA_URL), ''])
    expect(migrateOllamaProviders(out)).toEqual(out)
    expect(isOllamaProvider({ name: 'x', baseUrl: LAN })).toBe(true)
  })
})

describe('configured endpoint reaches the network layer', () => {
  const provider = { id: 'o', name: 'Ollama (local)', apiFormat: 'openai', baseUrl: ollamaApiBase(LAN), enabled: true } as const

  afterEach(() => vi.unstubAllGlobals())

  it('model listing GETs {endpoint}/v1/models', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ data: [{ id: 'llama3.3' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchProviderModels({ ...provider, apiKey: '' }, { isBrowser: false })
    expect(r.models.map((m) => m.id)).toEqual(['llama3.3'])
    expect(fetchMock.mock.calls[0][0]).toBe(`${LAN}/v1/models`)
  })

  it('chat POSTs {endpoint}/v1/chat/completions', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (..._a: unknown[]) => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { api: { platform: 'linux' } })
    useProviderStore.setState({ agentMode: 'build', sessionAgentModes: {}, nativeCodingTools: true } as any)
    await callLLM({
      decision: {
        provider,
        model: { id: 'o:m', providerId: 'o', modelId: 'llama3.3', label: 'L', tier: 'mid', enabled: true, contextWindow: 8000 },
        key: 'o:llama3.3', tier: 'mid', reason: 'test'
      },
      entries: [{ role: 'user', content: 'hello' }],
      systemLayers: ['SYS'], projectPreamble: '', sessionId: 's1', projectId: 'p1', assistantMsgId: 'm1',
      signal: new AbortController().signal
    } as any)
    expect(fetchMock.mock.calls[0][0]).toBe(`${LAN}/v1/chat/completions`)
  })
})
