import { describe, expect, it } from 'vitest'
import { prepareSideCall } from '../subscriptionSession'
import { buildTestRequestBody } from '../testProvider'
import { formatConnectionTestFailure, headersCarryKey, providerErrorReason } from '../providerErrors'

// What OpenRouter answers for a key it can't parse (curl, 2026-10-14) — with the
// header present. Without any header it says "No cookie auth credentials found".
const OPENROUTER_MALFORMED_KEY = 'HTTP 401: {"error":{"message":"Missing Authentication header","code":401}}'
const OPENROUTER_NO_HEADER = 'HTTP 401: {"error":{"message":"No cookie auth credentials found","code":401}}'
const DUMMY = 'dummy-not-a-real-key'

// Storage half (keychain + plaintext fallback round trip) lives in
// src/main/__tests__/providerKeyRoundTrip.test.ts; this is the request half.
function provider(apiKey: string) {
  return { baseUrl: 'http://localhost:18080/v1', apiKey, apiFormat: 'openai' as const }
}

async function testCallFor(p: ReturnType<typeof provider>) {
  return prepareSideCall(p, buildTestRequestBody('openai', 'mock-model-1'))
}

describe('Test connection request carries the loaded key', () => {
  it('sends the key as Bearer', async () => {
    const call = await testCallFor(provider(DUMMY))
    expect(call.headers.Authorization ?? call.headers.authorization).toBe(`Bearer ${DUMMY}`)
    expect(headersCarryKey(call.headers)).toBe(true)
  })
  it('no key → no credential header', async () => {
    const call = await testCallFor(provider(''))
    expect(headersCarryKey(call.headers)).toBe(false)
  })
})

describe('regression: a rejected key is not reported as "no API key was sent"', () => {
  it('OpenRouter "Missing Authentication header" with a key on the wire → invalid key', async () => {
    const call = await testCallFor(provider(DUMMY))
    const msg = formatConnectionTestFailure(OPENROUTER_MALFORMED_KEY, { keySent: headersCarryKey(call.headers) })
    expect(msg).not.toMatch(/no API key was sent/)
    expect(providerErrorReason(OPENROUTER_MALFORMED_KEY, { keySent: true })).toBe('invalidKey')
  })

  it('still says "no API key was sent" when no key went out', () => {
    expect(providerErrorReason(OPENROUTER_MALFORMED_KEY, { keySent: false })).toBe('missingKey')
    expect(providerErrorReason(OPENROUTER_NO_HEADER)).toBe('missingKey')
    expect(formatConnectionTestFailure(OPENROUTER_NO_HEADER, { keySent: false })).toMatch(/no API key was sent/)
  })

  it('headersCarryKey ignores empty credentials', () => {
    expect(headersCarryKey({ Authorization: 'Bearer ' })).toBe(false)
    expect(headersCarryKey({ authorization: 'Bearer x' })).toBe(true)
    expect(headersCarryKey({ 'x-api-key': 'k' })).toBe(true)
    expect(headersCarryKey({ 'Content-Type': 'application/json' })).toBe(false)
    expect(headersCarryKey(undefined)).toBe(false)
  })
})
