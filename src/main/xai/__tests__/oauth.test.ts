import { describe, expect, it } from 'vitest'
import { interpretPoll, parseDeviceCode, parseTokens } from '../oauth'

describe('xAI device-code parsing', () => {
  it('reads a device-code response', () => {
    const code = parseDeviceCode({
      device_code: 'dev',
      user_code: 'ABCD-1234',
      verification_uri: 'https://accounts.x.ai/device',
      verification_uri_complete: 'https://accounts.x.ai/device?code=ABCD-1234',
      expires_in: 600,
      interval: 5
    })
    expect(code.userCode).toBe('ABCD-1234')
    expect(code.intervalMs).toBe(5000)
    expect(code.verificationUriComplete).toContain('ABCD-1234')
  })

  it('treats pending and slow_down as still waiting', () => {
    expect(interpretPoll(400, { error: 'authorization_pending' })).toEqual({ kind: 'pending', slowDown: false })
    expect(interpretPoll(400, { error: 'slow_down' })).toEqual({ kind: 'pending', slowDown: true })
  })

  it('returns tokens and surfaces a denial', () => {
    expect(parseTokens({ access_token: 'atk', refresh_token: 'rtk', expires_in: 3600 }).accessToken).toBe('atk')
    expect(interpretPoll(400, { error: 'access_denied', error_description: 'no' })).toEqual({
      kind: 'error',
      message: 'no'
    })
  })
})
