import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyProviderError, describeProviderError, enrichTransportError, formatProviderError, providerErrorReason } from '../providerErrors'

describe('providerErrorReason', () => {
  const cases: Array<[string, string | null]> = [
    ['HTTP 401: {"error":{"message":"Incorrect API key provided"}}', 'invalidKey'],
    ['HTTP 401: {"type":"error","error":{"type":"authentication_error"}}', 'invalidKey'],
    ['HTTP 400: {"error":{"message":"You didn\'t provide an API key. Missing API key"}}', 'missingKey'],
    ['HTTP 401: x-api-key header is required', 'missingKey'],
    ['HTTP 403: {"error":"Your account does not have access"}', 'forbidden'],
    ['HTTP 404: {"error":{"code":"model_not_found"}}', 'unknownModel'],
    ['HTTP 400: {"error":{"message":"The model `gpt-9` does not exist"}}', 'unknownModel'],
    ['HTTP 429: {"error":{"type":"rate_limit_error"}}', 'rateLimit'],
    ['HTTP 400: {"error":{"code":"context_length_exceeded"}}', 'contextTooLong'],
    ['HTTP 400: prompt is too long: 210000 tokens > 200000 maximum', 'contextTooLong'],
    ['HTTP 413: request entity too large', 'contextTooLong'],
    ['HTTP 500: internal error', 'server'],
    ['HTTP 503: upstream proxy unavailable', 'server'],
    ['HTTP 529: {"type":"overloaded_error"}', 'server'],
    ['HTTP 407: Proxy Authentication Required', 'proxy'],
    ['TypeError: fetch failed (cause: getaddrinfo ENOTFOUND api.openai.com)', 'dns'],
    ['TypeError: fetch failed (cause: connect ECONNREFUSED 127.0.0.1:11434)', 'refused'],
    ['TypeError: fetch failed (cause: UND_ERR_CONNECT_TIMEOUT)', 'timeout'],
    ['net::ERR_INTERNET_DISCONNECTED', 'offline'],
    ['TypeError: Failed to fetch', 'offline'],
    ['tunneling socket could not be established, proxy refused', 'proxy'],
    ['HTTP 429: {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}', 'quota'],
    ['HTTP 400: {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}', 'quota'],
    ['HTTP 402: Payment Required', 'quota'],
    ['HTTP 404: <html>Cannot POST /chat/completions</html>', 'badEndpoint'],
    ['HTTP 404: {"error":"Not Found"}', 'badEndpoint'],
    ['HTTP 404: {"error":{"message":"model \'llama9\' not found"}}', 'unknownModel'],
    ['TypeError: fetch failed (cause: bad port)', 'badPort'],
    ['TypeError: Failed to fetch (cause: EBADPORT bad port)', 'badPort'],
    ['HTTP 400: bad request', null],
    ['something odd happened', null]
  ]
  it.each(cases)('%s → %s', (msg, reason) => {
    expect(providerErrorReason(msg)).toBe(reason)
  })
})

describe('classifyProviderError', () => {
  it('maps reason to kind and settings target', () => {
    expect(classifyProviderError('HTTP 401: nope')).toMatchObject({ kind: 'auth', reason: 'invalidKey', settingsTarget: 'providers' })
    expect(classifyProviderError('HTTP 404: model not found')).toMatchObject({ kind: 'model', settingsTarget: 'models' })
    expect(classifyProviderError('HTTP 404: Not Found')).toMatchObject({ kind: 'config', reason: 'badEndpoint', settingsTarget: 'providers' })
    expect(classifyProviderError('HTTP 429: {"error":{"code":"insufficient_quota"}}')).toMatchObject({ kind: 'billing', reason: 'quota' })
    expect(classifyProviderError('connect ECONNREFUSED')).toMatchObject({ kind: 'network', reason: 'refused' })
    expect(classifyProviderError('connect ECONNREFUSED').settingsTarget).toBeUndefined()
    expect(classifyProviderError('weird')).toEqual({ kind: 'generic', detail: 'weird' })
  })
  it('truncates long detail', () => {
    expect(classifyProviderError('x'.repeat(900)).detail.length).toBe(501)
  })
})

describe('describeProviderError', () => {
  it('gives a cause and a concrete fix for every reason', () => {
    for (const msg of ['HTTP 401: a', 'HTTP 403: a', 'HTTP 429: a', 'HTTP 502: a', 'HTTP 404: a', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'HTTP 407: a', 'context_length_exceeded', 'missing api key', 'Failed to fetch', 'insufficient_quota', 'bad port']) {
      const c = describeProviderError(classifyProviderError(msg))
      expect(c.title).toBeTruthy()
      expect(c.cause).toBeTruthy()
      expect(c.fix).toBeTruthy()
    }
    expect(describeProviderError({ kind: 'auth', reason: 'invalidKey' }).fix).toContain('Settings → Providers')
  })
  it('falls back to kind copy for legacy cards without a reason', () => {
    expect(describeProviderError({ kind: 'auth' })).toEqual({
      title: 'The provider rejected your credentials',
      cause: '',
      fix: 'Check the API key in Settings → Providers, then retry.'
    })
    expect(describeProviderError({ kind: 'bogus' as never }).title).toBe('The request failed')
    expect(describeProviderError({ kind: 'config', reason: 'setup' }).fix).toContain('Settings → Providers')
    expect(describeProviderError({ kind: 'billing', reason: 'quota' }).fix).toMatch(/credits|billing/)
  })
  it('formats a single line for logs', () => {
    expect(formatProviderError('HTTP 401: x')).toMatch(/^The provider rejected your credentials\. .*Fix: Check or replace the key/)
  })
})

describe('withProviderErrorFix', () => {
  it('appends a fix only for known causes', async () => {
    const { withProviderErrorFix } = await import('../providerErrors')
    expect(withProviderErrorFix('FAIL: 401', 'HTTP 401: bad')).toBe('FAIL: 401 — Check or replace the key in Settings → Providers, then retry.')
    expect(withProviderErrorFix('FAIL: 400', 'HTTP 400: bad')).toBe('FAIL: 400')
  })
})

describe('enrichTransportError', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appends the probe cause so a bare fetch failure classifies', async () => {
    const probe = vi.fn(async () => ({ ok: false, code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1' }))
    vi.stubGlobal('window', { api: { net: { probe } } })
    const out = await enrichTransportError('TypeError: Failed to fetch', 'http://127.0.0.1:1/v1')
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:1/v1')
    expect(out).toBe('TypeError: Failed to fetch (cause: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:1)')
    expect(providerErrorReason(out)).toBe('refused')
  })

  it('maps an unsafe-port probe to badPort', async () => {
    vi.stubGlobal('window', { api: { net: { probe: async () => ({ ok: false, code: 'EBADPORT', message: 'bad port' }) } } })
    const out = await enrichTransportError('Failed to fetch', 'http://127.0.0.1:6000/v1')
    expect(providerErrorReason(out)).toBe('badPort')
  })

  it('leaves other messages, missing urls, and probe failures unchanged', async () => {
    const probe = vi.fn(async () => {
      throw new Error('ipc down')
    })
    vi.stubGlobal('window', { api: { net: { probe } } })
    expect(await enrichTransportError('HTTP 401: no', 'http://127.0.0.1/v1')).toBe('HTTP 401: no')
    expect(await enrichTransportError('Failed to fetch (cause: ECONNREFUSED)', 'http://127.0.0.1/v1')).toBe('Failed to fetch (cause: ECONNREFUSED)')
    expect(await enrichTransportError('Failed to fetch', undefined)).toBe('Failed to fetch')
    expect(await enrichTransportError('NetworkError when attempting to fetch resource.', 'http://127.0.0.1/v1')).toBe('NetworkError when attempting to fetch resource.')
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe('errorTextWithCause', () => {
  it('appends undici cause code so network errors classify', async () => {
    const { errorTextWithCause, providerErrorReason } = await import('../providerErrors')
    const err = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) })
    const text = errorTextWithCause(err)
    expect(text).toBe('fetch failed (cause: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:1)')
    expect(providerErrorReason(text)).toBe('refused')
    expect(errorTextWithCause(new Error('HTTP 401: x'))).toBe('HTTP 401: x')
    expect(errorTextWithCause('plain')).toBe('plain')
  })
})

describe('secret masking in error detail', () => {
  it('never puts a key into detail, fix lines, or cause text', async () => {
    const m = await import('../providerErrors')
    const key = 'sk-proj-AbCdEf0123456789ghijKLMNOP'
    const msg = `HTTP 401: {"error":{"message":"Incorrect API key provided: ${key}"}}`
    expect(m.classifyProviderError(msg).detail).not.toContain(key)
    expect(m.withProviderErrorFix(`FAIL: 401 — ${key}`, msg)).not.toContain(key)
    expect(m.errorTextWithCause(new Error(`bad Bearer ${key}`))).not.toContain(key)
  })
})
