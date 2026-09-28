import { describe, expect, it } from 'vitest'
import { accountFromIdToken, interpretDevicePoll, parseDeviceStart, parseOAuthTokens } from '../chatgpt'
import { parseClaudeCallback, parseClaudeTokens, startClaudeLogin } from '../claude'
import { ANTIGRAVITY_REDIRECT, projectIdFromLoad, startAntigravityLogin, tierIdFromLoad } from '../antigravity'

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `h.${body}.s`
}

describe('ChatGPT device-code parsing', () => {
  it('reads a user code and treats 404 as still waiting', () => {
    const code = parseDeviceStart({ device_auth_id: 'dev', user_code: 'ABCD-1234', interval: '5' })
    expect(code.userCode).toBe('ABCD-1234')
    expect(code.verificationUri).toBe('https://auth.openai.com/codex/device')
    expect(code.intervalMs).toBe(5000)
    expect(interpretDevicePoll(404, {})).toEqual({ kind: 'pending' })
    expect(interpretDevicePoll(403, {})).toEqual({ kind: 'pending' })
  })

  it('returns the server PKCE verifier and reads the account id from the id token', () => {
    expect(interpretDevicePoll(200, { authorization_code: 'ac', code_verifier: 'ver' })).toEqual({
      kind: 'code',
      authorizationCode: 'ac',
      codeVerifier: 'ver'
    })
    const id = jwt({
      email: 'a@b.c',
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' }
    })
    expect(accountFromIdToken(id)).toEqual({ email: 'a@b.c', accountId: 'acct_1' })
    expect(parseOAuthTokens({ access_token: 'atk', refresh_token: 'rtk', expires_in: 10, id_token: id }).accountId).toBe('acct_1')
  })
})

describe('Claude code paste', () => {
  it('splits code#state and builds a PKCE authorize URL', () => {
    expect(parseClaudeCallback('abc#state1')).toEqual({ code: 'abc', state: 'state1' })
    expect(parseClaudeCallback('https://platform.claude.com/oauth/code/callback?code=c&state=s')).toEqual({
      code: 'c',
      state: 's'
    })
    const start = startClaudeLogin()
    const url = new URL(start.url)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(start.state)
    expect(url.searchParams.get('redirect_uri')).toBe('https://platform.claude.com/oauth/code/callback')
  })

  it('reads the account email from the token response', () => {
    expect(parseClaudeTokens({
      access_token: 'atk',
      refresh_token: 'rtk',
      expires_in: 60,
      account: { email_address: 'a@b.c' }
    }).email).toBe('a@b.c')
  })
})

describe('Antigravity login', () => {
  it('pins the registered loopback redirect and reads a project id', () => {
    const prevId = process.env.PAWN_ANTIGRAVITY_CLIENT_ID
    const prevSecret = process.env.PAWN_ANTIGRAVITY_CLIENT_SECRET
    process.env.PAWN_ANTIGRAVITY_CLIENT_ID = 'test-client'
    process.env.PAWN_ANTIGRAVITY_CLIENT_SECRET = 'test-secret'
    try {
      const start = startAntigravityLogin()
      const url = new URL(start.url)
      expect(url.searchParams.get('client_id')).toBe('test-client')
      expect(url.searchParams.get('redirect_uri')).toBe(ANTIGRAVITY_REDIRECT)
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(projectIdFromLoad({ cloudaicompanionProject: { id: 'proj' } })).toBe('proj')
      expect(projectIdFromLoad({ project: 'plain' })).toBe('plain')
      expect(tierIdFromLoad({ allowedTiers: [{ id: 'standard-tier' }] })).toBe('standard-tier')
    } finally {
      if (prevId === undefined) delete process.env.PAWN_ANTIGRAVITY_CLIENT_ID
      else process.env.PAWN_ANTIGRAVITY_CLIENT_ID = prevId
      if (prevSecret === undefined) delete process.env.PAWN_ANTIGRAVITY_CLIENT_SECRET
      else process.env.PAWN_ANTIGRAVITY_CLIENT_SECRET = prevSecret
    }
  })
})
