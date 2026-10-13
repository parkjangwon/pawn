import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseRetryAfterHeader,
  calculateBackoffDelay,
  fetchWithRetry,
  markTransient
} from '../llm'
import { CONNECT_TIMEOUT_MS, type ConnectChecker } from '../llmRetry'
import { classifyProviderError } from '../providerErrors'

describe('llm retry and backoff utilities', () => {
  describe('parseRetryAfterHeader', () => {
    it('returns null for empty or invalid header', () => {
      expect(parseRetryAfterHeader(null)).toBeNull()
      expect(parseRetryAfterHeader(undefined)).toBeNull()
      expect(parseRetryAfterHeader('')).toBeNull()
      expect(parseRetryAfterHeader('invalid-string')).toBeNull()
    })

    it('parses integer seconds correctly', () => {
      expect(parseRetryAfterHeader('5')).toBe(5000)
      expect(parseRetryAfterHeader(' 12 ')).toBe(12000)
      expect(parseRetryAfterHeader('0')).toBe(100) // Minimum 100ms
    })

    it('caps large retry-after seconds to max limit', () => {
      expect(parseRetryAfterHeader('100')).toBe(30000) // Max 30s
    })

    it('parses valid HTTP-date in the future', () => {
      const future = new Date(Date.now() + 8000).toUTCString()
      const delay = parseRetryAfterHeader(future)
      expect(delay).toBeGreaterThan(5000)
      expect(delay).toBeLessThanOrEqual(10000)
    })
  })

  describe('calculateBackoffDelay', () => {
    it('uses retryAfterMs directly when provided', () => {
      expect(calculateBackoffDelay(1, false, 4500)).toBe(4500)
      expect(calculateBackoffDelay(2, true, 8000)).toBe(8000)
    })

    it('calculates exponential backoff with jitter for transient errors', () => {
      const delay1 = calculateBackoffDelay(1, false)
      const delay2 = calculateBackoffDelay(2, false)
      const delay3 = calculateBackoffDelay(3, false)

      expect(delay1).toBeGreaterThanOrEqual(500)
      expect(delay1).toBeLessThanOrEqual(6000)
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.8)
      expect(delay3).toBeLessThanOrEqual(6000)
    })

    it('uses higher base and cap for rate limits (429)', () => {
      const delay1 = calculateBackoffDelay(1, true)
      expect(delay1).toBeGreaterThanOrEqual(1200)
      expect(delay1).toBeLessThanOrEqual(12000)
    })
  })

  describe('fetchWithRetry', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
    })

    it('returns response immediately on HTTP 200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      const controller = new AbortController()

      const res = await fetchWithRetry('https://example.com/api', {}, {}, false, controller.signal)
      expect(res.status).toBe(200)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('retries on 429 rate limit and succeeds on retry', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return new Response('Rate limit exceeded', {
            status: 429,
            headers: { 'retry-after': '1' }
          })
        }
        return new Response('success', { status: 200 })
      })

      const controller = new AbortController()
      const resPromise = fetchWithRetry('https://example.com/api', {}, {}, false, controller.signal)

      // Advance timers to trigger backoff wait
      await vi.advanceTimersByTimeAsync(2000)

      const res = await resPromise
      expect(res.status).toBe(200)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })

    it('does not retry 400 Bad Request and throws immediately', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('Invalid json', { status: 400 }))
      const controller = new AbortController()

      await expect(
        fetchWithRetry('https://example.com/api', {}, {}, false, controller.signal)
      ).rejects.toThrow('HTTP 400')
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })
  })
})

function causeCode(err: unknown): string {
  let cur: unknown = err
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string') return code
    cur = (cur as { cause?: unknown }).cause
  }
  return ''
}

/** Never settles until the attempt signal aborts. */
function hangUntilAbort(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal
    const abort = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'))
    if (!signal || signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  }))
}

const connectTimedOut: ConnectChecker = async () => ({ ok: false, code: 'UND_ERR_CONNECT_TIMEOUT' })

describe('fetchWithRetry connect timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stops after two connect-phase timeouts, skips the probe, and reports retry 1/2', async () => {
    const probe = vi.fn(async () => ({ ok: false, code: 'ECONNREFUSED', message: 'connect refused' }))
    const checker = vi.fn(connectTimedOut)
    vi.stubGlobal('window', { api: { net: { probe, connectCheck: checker } } })
    const fetchMock = hangUntilAbort()
    vi.stubGlobal('fetch', fetchMock)
    const seen: Array<{ phase: string; attempt?: number; max?: number }> = []
    const started = Date.now()
    const err = await fetchWithRetry(
      'https://10.255.255.1/v1',
      {},
      {},
      false,
      new AbortController().signal,
      undefined,
      (ev) => seen.push(ev)
    ).catch((e) => e)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(checker).toHaveBeenCalledTimes(2)
    expect(checker).toHaveBeenCalledWith('https://10.255.255.1/v1', CONNECT_TIMEOUT_MS)
    expect(err.message).toContain('connect-phase timeout')
    expect(causeCode(err)).toBe('UND_ERR_CONNECT_TIMEOUT')
    expect(err.cause).toEqual({ code: 'UND_ERR_CONNECT_TIMEOUT', message: 'connect timeout' })
    expect(err.transient).toBe(true)
    expect(classifyProviderError(err.message).reason).toBe('timeout')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(probe).not.toHaveBeenCalled()
    expect(seen).toEqual([
      { phase: 'connecting' },
      { phase: 'retrying', attempt: 1, max: 2 }
    ])
  })

  it('rethrows a caller abort during connect', async () => {
    const controller = new AbortController()
    let started!: () => void
    const pendingStart = new Promise<void>((resolve) => { started = resolve })
    const checker = vi.fn(() => new Promise<{ ok: false; code: string }>(() => {}))
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      started()
      const abort = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'))
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    })))
    const pending = fetchWithRetry('https://x.test', {}, {}, false, controller.signal, undefined, undefined, checker)
    await pendingStart
    controller.abort()
    const err = await pending.catch((e) => e)
    expect(err).toBeInstanceOf(DOMException)
    expect(err.name).toBe('AbortError')
    expect(String(err.message)).not.toContain('connect-phase')
    expect(checker).toHaveBeenCalledTimes(1)
  })

  it('does not abort a slow body after headers arrive', async () => {
    const checker = vi.fn(connectTimedOut)
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => {
      const signal = init?.signal
      const stream = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            if (signal?.aborted) {
              controller.error(new DOMException('The operation was aborted.', 'AbortError'))
              return
            }
            controller.enqueue(new TextEncoder().encode('ok'))
            controller.close()
          }, 80)
        }
      })
      return Promise.resolve(new Response(stream, { status: 200 }))
    }))
    const res = await fetchWithRetry('https://x.test', {}, {}, false, new AbortController().signal, undefined, undefined, checker)
    expect(await res.text()).toBe('ok')
    expect(checker).toHaveBeenCalledTimes(1)
  })

  it('does not abort the fetch when the connect check is skipped for a proxy', async () => {
    const checker = vi.fn(async () => ({ ok: true as const, skipped: true, reason: 'proxy' as const, ms: 0 as const }))
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (init?.signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
          return
        }
        resolve(new Response('ok', { status: 200 }))
      }, 30)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
    })))
    const res = await fetchWithRetry('https://x.test/v1', {}, {}, false, new AbortController().signal, undefined, undefined, checker)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(checker).toHaveBeenCalledTimes(1)
  })

  it('lets a slow reasoning model finish when the connect check succeeds', async () => {
    vi.useFakeTimers()
    const checker = vi.fn(async () => ({ ok: true as const, ms: 4 }))
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('reasoned', { status: 200 })), 30_000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
    })))
    const pending = fetchWithRetry('https://x.test/v1', {}, {}, false, new AbortController().signal, undefined, undefined, checker)
    await vi.advanceTimersByTimeAsync(30_000)
    const res = await pending
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('reasoned')
    expect(checker).toHaveBeenCalledTimes(1)
    expect(checker).toHaveBeenCalledWith('https://x.test/v1', CONNECT_TIMEOUT_MS)
  })

  it('still retries a fetch error when the connect check did not time out', async () => {
    vi.useFakeTimers()
    const checker = vi.fn(async () => ({ ok: false as const, code: 'ECONNREFUSED' }))
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = fetchWithRetry(
      'https://x.test/v1',
      {},
      {},
      false,
      new AbortController().signal,
      undefined,
      undefined,
      checker
    ).catch((e) => e)
    await vi.advanceTimersByTimeAsync(30_000)
    const err = await pending
    expect(err).toBeInstanceOf(TypeError)
    expect(String(err.message)).toBe('Failed to fetch')
    expect(String(err.message)).not.toContain('connect-phase')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(checker).toHaveBeenCalledTimes(3)
  })

  it('does not run the connect check on the browser proxy branch', async () => {
    const checker = vi.fn(connectTimedOut)
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    const res = await fetchWithRetry('https://10.255.255.1/v1', {}, {}, true, signal, undefined, undefined, checker)
    expect(res.status).toBe(200)
    expect(checker).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/proxy')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(signal)
  })
})
