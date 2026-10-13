import { describe, expect, it } from 'vitest'
import { formatAllAttemptsFailed } from '../providerErrors'
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

  it('masks bare assignments, url userinfo, auth schemes, and hf tokens', () => {
    expect(redactSecrets('HTTP 401 key=Zq8xL2mN4pR6tV8wY0aC3eG5iK7oQ9sU')).toBe('HTTP 401 key=***')
    expect(redactSecrets('api_key: Zq8xL2mN4pR6tV8w')).toBe('api_key: ***')
    expect(redactSecrets('token=0123456789abcdef')).toBe('token=***')
    expect(redactSecrets('secret: hunter2hunter2')).toBe('secret: ***')
    expect(redactSecrets('password=correcthorsebatterystaple')).toBe('password=***')
    expect(redactSecrets('https://user:PASS@host/')).toBe('https://user:***@host/')
    expect(redactSecrets('http://Zq8xL2mN4pR6@host/v1')).toBe('http://***@host/v1')
    expect(redactSecrets('https://hf_AbCdEf0123456789@host/')).toBe('https://***@host/')
    expect(redactSecrets('BEARER abcdefghij1234567890')).toBe('BEARER ***')
    expect(redactSecrets('bearer abcdefghij1234567890')).toBe('bearer ***')
    expect(redactSecrets('Basic dXNlcjpwYXNzMTIz')).toBe('Basic ***')
    expect(redactSecrets('hf_AbCdEf0123456789')).toBe('hf_***')
  })

  it('does not mask prose, emails, plain urls, or short values', () => {
    for (const s of [
      'the key is missing',
      'token limit exceeded',
      'email user@example.com',
      'https://example.com/path',
      'key: 404',
      'https://username@github.com/org/repo',
      'hf_short',
      'monkey=abcdefghij'
    ]) {
      expect(redactSecrets(s)).toBe(s)
    }
  })

  it('masks tokens in URL paths', () => {
    const tok = 'AbCdEf0123456789ghijKLMN'
    expect(redactSecrets(`https://h/v1/keys/${tok}/x`)).toBe('https://h/v1/keys/***/x')
    expect(redactSecrets('https://h/v1/key/s3cr3t/x')).toBe('https://h/v1/key/***/x')
    expect(redactSecrets('https://h/v1/tokens/s3cr3t/x')).toBe('https://h/v1/tokens/***/x')
    expect(redactSecrets('https://h/v1/token/s3cr3t/x')).toBe('https://h/v1/token/***/x')
    expect(redactSecrets('https://h/v1/secret/s3cr3t/x')).toBe('https://h/v1/secret/***/x')
    expect(redactSecrets('https://h/v1/api-key/s3cr3t/x')).toBe('https://h/v1/api-key/***/x')
    expect(redactSecrets(`https://h/v1/${tok}/x?y=1`)).toBe('https://h/v1/***/x?y=1')
    expect(redactSecrets('https://h/v1/abcdefghijklmnopqrstuvwxyz/x')).toBe('https://h/v1/abcdefghijklmnopqrstuvwxyz/x')
  })

  it('masks short passwords in assignments and URL userinfo', () => {
    expect(redactSecrets('password=hunter2')).toBe('password=***')
    expect(redactSecrets('passwd=x')).toBe('passwd=***')
    expect(redactSecrets('pwd: a')).toBe('pwd: ***')
    expect(redactSecrets('https://user:a@host/')).toBe('https://user:***@host/')
    expect(redactSecrets('key: 404')).toBe('key: 404')
  })

  it('masks a key continued on the next line', () => {
    expect(redactSecrets('sk-abcdefgh\nijklmnopqrstuvwxyz')).toBe('sk-***\n***')
    expect(redactSecrets('HTTP 401 key=Zq8xL2mN4pR6tV8wY0aC3eG5iK7oQ9sU\nUnauthorized')).toBe('HTTP 401 key=***\nUnauthorized')
  })

  it('masks ws and wss userinfo', () => {
    expect(redactSecrets('wss://user:token@host/v1')).toBe('wss://user:***@host/v1')
    expect(redactSecrets('ws://user:x@host/')).toBe('ws://user:***@host/')
  })

  it('redacts secrets in formatAllAttemptsFailed output', () => {
    const same = formatAllAttemptsFailed(
      { label: 'gpt-4o', message: `Incorrect API key provided: ${OPENAI}` },
      { label: 'gpt-4o', message: `Incorrect API key provided: ${OPENAI}` }
    )
    expect(same).toBe('All model attempts failed. gpt-4o: Incorrect API key provided: sk-***')
    expect(same).not.toContain(OPENAI)
    const other = formatAllAttemptsFailed(
      { label: 'gpt-4o', message: 'key: 404' },
      { label: 'claude', message: 'password=hunter2' }
    )
    expect(other).toBe('All model attempts failed. gpt-4o: key: 404 (fallbacks also failed; last: claude: password=***)')
  })
})
