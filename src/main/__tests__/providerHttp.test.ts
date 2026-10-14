import { describe, it, expect, vi } from 'vitest'
import { checkProviderTarget, runProviderRequest, sanitizeRequest, savedHttpOrigins, type ProviderHttpSink } from '../providerHttp'

const LAN = 'http://192.168.0.10:11434'

function sink(): ProviderHttpSink & { events: string[]; text: () => string } {
  const events: string[] = []
  const chunks: Uint8Array[] = []
  return {
    events,
    text: () => Buffer.concat(chunks).toString('utf8'),
    head: (s) => events.push(`head:${s}`),
    chunk: (d) => { chunks.push(d); events.push('chunk') },
    end: () => events.push('end'),
    error: (m) => events.push(`error:${m}`)
  }
}

function streamResponse(parts: string[], status = 200): Response {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close() } }), {
    status, headers: { 'content-type': 'text/event-stream' }
  })
}

describe('checkProviderTarget allowlist', () => {
  const providers = [{ baseUrl: `${LAN}/v1` }, { baseUrl: 'http://127.0.0.1:18080/v1' }, { baseUrl: 'https://api.openai.com/v1' }]

  it('allows saved http origins, any path', () => {
    expect(checkProviderTarget(`${LAN}/v1/chat/completions`, providers).ok).toBe(true)
    expect(checkProviderTarget('http://127.0.0.1:18080/v1/models', providers).ok).toBe(true)
  })

  it('rejects an unsaved origin, including another port or host on the same machine', () => {
    for (const u of ['http://192.168.0.11:11434/v1', 'http://192.168.0.10:9999/v1', 'http://localhost:18080/v1', 'http://evil.example/v1']) {
      const r = checkProviderTarget(u, providers)
      expect(r.ok, u).toBe(false)
    }
  })

  it('rejects credentials in the url, non-http schemes and junk', () => {
    expect(checkProviderTarget('http://user:pw@192.168.0.10:11434/v1', providers)).toMatchObject({ ok: false, error: expect.stringMatching(/credentials/) })
    expect(checkProviderTarget('https://api.openai.com/v1/models', providers).ok).toBe(false)
    expect(checkProviderTarget('file:///etc/passwd', providers).ok).toBe(false)
    expect(checkProviderTarget('not a url', providers).ok).toBe(false)
    expect(checkProviderTarget(42, providers).ok).toBe(false)
  })

  it('ignores saved providers whose baseUrl carries credentials', () => {
    expect(savedHttpOrigins([{ baseUrl: 'http://u:p@10.0.0.1:1/v1' }, { baseUrl: 'garbage' }]).size).toBe(0)
  })
})

describe('sanitizeRequest', () => {
  it('limits methods and strips hop/identity headers', () => {
    expect(sanitizeRequest({ url: 'x', method: 'DELETE' }).ok).toBe(false)
    const r = sanitizeRequest({ url: 'x', method: 'post', headers: { Host: 'evil', Cookie: 'a', Authorization: 'Bearer t', 'X-Bad': 'a\r\nb' }, body: '{}' })
    expect(r).toMatchObject({ ok: true, method: 'POST', headers: { authorization: 'Bearer t' } })
    if (r.ok) expect(Object.keys(r.headers)).toEqual(['authorization'])
  })
})

describe('runProviderRequest', () => {
  it('reads saved providers fresh: a newly saved origin works on the next request without reload', async () => {
    let saved: Array<{ baseUrl: string }> = []
    const fetch = vi.fn(async () => streamResponse(['ok']))
    const deps = { providers: () => saved, fetch }
    const before = sink()
    await runProviderRequest({ url: `${LAN}/v1/models` }, new AbortController().signal, deps, before)
    expect(before.events[0]).toMatch(/^error:refused: origin http:\/\/192\.168\.0\.10:11434 is not a saved provider/)
    expect(fetch).not.toHaveBeenCalled()

    saved = [{ baseUrl: `${LAN}/v1` }]
    const after = sink()
    await runProviderRequest({ url: `${LAN}/v1/models` }, new AbortController().signal, deps, after)
    expect(after.events).toEqual(['head:200', 'chunk', 'end'])
    expect(fetch).toHaveBeenCalledWith(`${LAN}/v1/models`, expect.objectContaining({ method: 'GET', redirect: 'manual' }))
  })

  it('editing a provider baseUrl drops the old origin', async () => {
    let saved = [{ baseUrl: `${LAN}/v1` }]
    const deps = { providers: () => saved, fetch: vi.fn(async () => streamResponse(['ok'])) }
    saved = [{ baseUrl: 'http://192.168.0.20:11434/v1' }]
    const old = sink()
    await runProviderRequest({ url: `${LAN}/v1/models` }, new AbortController().signal, deps, old)
    expect(old.events[0]).toMatch(/^error:refused/)
    const fresh = sink()
    await runProviderRequest({ url: 'http://192.168.0.20:11434/v1/models' }, new AbortController().signal, deps, fresh)
    expect(fresh.events.at(-1)).toBe('end')
  })

  it('streams chunks in order with the status', async () => {
    const deps = { providers: () => [{ baseUrl: `${LAN}/v1` }], fetch: async () => streamResponse(['data: a\n\n', 'data: b\n\n', 'data: [DONE]\n\n'], 200) }
    const s = sink()
    await runProviderRequest({ url: `${LAN}/v1/chat/completions`, method: 'POST', body: '{}' }, new AbortController().signal, deps, s)
    expect(s.events).toEqual(['head:200', 'chunk', 'chunk', 'chunk', 'end'])
    expect(s.text()).toBe('data: a\n\ndata: b\n\ndata: [DONE]\n\n')
  })

  it('abort mid-stream ends with an aborted error', async () => {
    const ctl = new AbortController()
    const fetch = async (_u: string, init: { signal: AbortSignal }): Promise<Response> => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: a\n\n'))
        init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
      }
    }))
    const s = sink()
    const run = runProviderRequest({ url: `${LAN}/x`, method: 'POST', body: '{}' }, ctl.signal, { providers: () => [{ baseUrl: LAN }], fetch }, s)
    await vi.waitFor(() => expect(s.events).toContain('chunk'))
    ctl.abort()
    await run
    expect(s.events.at(-1)).toBe('error:aborted')
  })

  it('reports transport failures', async () => {
    const s = sink()
    await runProviderRequest({ url: `${LAN}/x` }, new AbortController().signal, {
      providers: () => [{ baseUrl: LAN }],
      fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }) }
    }, s)
    expect(s.events).toEqual(['error:fetch failed (cause: ECONNREFUSED)'])
  })
})
