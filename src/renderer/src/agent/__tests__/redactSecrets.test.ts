import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../redactSecrets'

const OPENAI = 'sk-proj-AbCdEf0123456789ghijKLMNOP'
const ANT = 'sk-ant-api03-AbCdEf0123456789_ghij-KLMN'

describe('redactSecrets', () => {
  it.each([
    [`Incorrect API key provided: ${OPENAI}. You can find your key at …`, OPENAI],
    [`{"error":{"message":"invalid x-api-key ${ANT}"}}`, ANT],
    ['Authorization: Bearer eyJabc.def123456.ghi789012zz', 'eyJabc.def123456'],
    ['request headers {"authorization":"Bearer abcdefghij1234567890"}', 'abcdefghij1234567890'],
    ['{"api_key":"plainsecretvalue123"}', 'plainsecretvalue123'],
    ['x-api-key=zzzzyyyyxxxx1111', 'zzzzyyyyxxxx1111'],
    ['GET https://generativelanguage.googleapis.com/v1/models?key=AIzaSyA1234567890abcdefghijklmnop&alt=sse', 'AIzaSyA1234567890'],
    ['url ?access_token=tok_123456789&x=1', 'tok_123456789'],
    ['key xai-AbCdEf0123456789xyz rejected', 'xai-AbCdEf0123456789xyz'],
    ['token: 0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef']
  ])('masks %s', (input, secret) => {
    const out = redactSecrets(input)
    expect(out).not.toContain(secret)
    expect(out).toContain('***')
  })

  it('keeps ordinary error text intact', () => {
    const s = 'HTTP 429: {"error":{"message":"Rate limit reached for gpt-4o in organization org on tokens per min","type":"tokens"}}'
    expect(redactSecrets(s)).toBe(s)
    expect(redactSecrets('HTTP 404: model `gpt-9` does not exist')).toBe('HTTP 404: model `gpt-9` does not exist')
    expect(redactSecrets('')).toBe('')
  })
})
