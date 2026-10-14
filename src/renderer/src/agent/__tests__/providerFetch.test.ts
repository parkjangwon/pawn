import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../stores/provider', () => ({ whenProviderSavesSettled: () => Promise.resolve() }))
import { providerFetch } from '../providerFetch'

type Evt = Parameters<Parameters<NonNullable<Window['api']>['providerHttp']['start']>[2]>[0]

let start: ReturnType<typeof vi.fn>
let abort: ReturnType<typeof vi.fn>
const g = globalThis as unknown as { window?: unknown; fetch: typeof fetch }
const realFetch = g.fetch

beforeEach(() => {
  start = vi.fn()
  abort = vi.fn(async () => ({ ok: true }))
  g.window = { api: { providerHttp: { start, abort } } }
})
afterEach(() => {
  delete g.window
  g.fetch = realFetch
})

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('providerFetch', () => {
  it('uses native fetch for https', async () => {
    const native = vi.fn(async () => new Response('x'))
    g.fetch = native as unknown as typeof fetch
    await providerFetch('https://api.example.com/v1/models')
    expect(native).toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('routes http through main and streams the body', async () => {
    start.mockImplementation(async (_id: string, req: { method: string; headers: Record<string, string> }, on: (e: Evt) => void) => {
      expect(req.method).toBe('POST')
      expect(req.headers).toEqual({ authorization: 'Bearer t', 'content-type': 'application/json' })
      on({ type: 'head', status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] })
      on({ type: 'chunk', data: enc('data: a\n\n') })
      on({ type: 'chunk', data: enc('data: b\n\n') })
      on({ type: 'end' })
      return { ok: true }
    })
    const r = await providerFetch('http://127.0.0.1:18080/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{}'
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/event-stream')
    expect(await r.text()).toBe('data: a\n\ndata: b\n\n')
  })

  it('a refused origin rejects like a network error', async () => {
    start.mockImplementation(async (_id: string, _r: unknown, on: (e: Evt) => void) => {
      on({ type: 'error', message: 'refused: origin http://10.9.9.9:1 is not a saved provider' })
      return { ok: false, error: 'refused' }
    })
    await expect(providerFetch('http://10.9.9.9:1/v1/models')).rejects.toMatchObject({ name: 'TypeError', message: 'Failed to fetch' })
  })

  it('abort cancels in main and rejects with AbortError', async () => {
    let resolveStart!: (v: { ok: boolean }) => void
    start.mockImplementation(() => new Promise((r) => { resolveStart = r }))
    const ctl = new AbortController()
    const p = providerFetch('http://127.0.0.1:18080/v1/chat/completions', { method: 'POST', body: '{}', signal: ctl.signal })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    ctl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledWith(start.mock.calls[0][0])
    resolveStart({ ok: false })
  })

  it('abort mid-stream errors the body', async () => {
    let on!: (e: Evt) => void
    start.mockImplementation((_id: string, _r: unknown, cb: (e: Evt) => void) => { on = cb; return new Promise(() => {}) })
    const ctl = new AbortController()
    const p = providerFetch('http://127.0.0.1:18080/x', { method: 'POST', body: '{}', signal: ctl.signal })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    on({ type: 'head', status: 200, statusText: 'OK', headers: [] })
    on({ type: 'chunk', data: enc('a') })
    const res = await p
    const reader = res.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('a')
    ctl.abort()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalled()
  })
})
