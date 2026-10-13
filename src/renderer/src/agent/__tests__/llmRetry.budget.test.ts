import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, RETRY_WAIT_BUDGET_MS } from '../llmRetry'

const res = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, { status, headers })

const run = () => fetchWithRetry('https://x.test', {}, {}, false, new AbortController().signal)

describe('fetchWithRetry budget', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not retry 429 insufficient_quota', async () => {
    const f = vi.fn(async () => res(429, '{"error":{"code":"insufficient_quota"}}'))
    vi.stubGlobal('fetch', f)
    const err = await run().catch((e) => e)
    expect(f).toHaveBeenCalledTimes(1)
    expect(err.transient).toBe(false)
  })

  it('stays within the wait budget on repeated Retry-After: 30', async () => {
    const f = vi.fn(async () => res(429, 'slow down', { 'retry-after': '30' }))
    vi.stubGlobal('fetch', f)
    const p = run().catch((e) => e)
    await vi.advanceTimersByTimeAsync(RETRY_WAIT_BUDGET_MS)
    const err = await p
    expect(err).toBeInstanceOf(Error)
    expect(err.transient).toBe(true)
    expect(f.mock.calls.length).toBeLessThanOrEqual(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits Retry-After: 2 once then succeeds', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(429, 'rate', { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(200, 'ok'))
    vi.stubGlobal('fetch', f)
    const p = run()
    await vi.advanceTimersByTimeAsync(1999)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('probes a failing fetch once across retries and reuses it for the same signal', async () => {
    const probe = vi.fn(async () => ({ ok: false, code: 'ECONNREFUSED', message: 'connect refused' }))
    vi.stubGlobal('window', { api: { net: { probe } } })
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    const fail = async (sig: AbortSignal): Promise<Error> => {
      try {
        await fetchWithRetry('https://down.test/v1', {}, {}, false, sig)
      } catch (e) {
        return e as Error
      }
      throw new Error('expected fetchWithRetry to fail')
    }

    const first = fail(signal)
    await vi.advanceTimersByTimeAsync(30_000)
    const err = await first
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith('https://down.test/v1')
    expect(err.message).toContain('ECONNREFUSED')

    const second = fail(signal)
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await second).message).toContain('ECONNREFUSED')
    expect(probe).toHaveBeenCalledTimes(1)

    const other = fail(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await other).message).toContain('ECONNREFUSED')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('still retries 503', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(503, 'unavailable'))
      .mockResolvedValueOnce(res(200, 'ok'))
    vi.stubGlobal('fetch', f)
    const p = run()
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await p).ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
