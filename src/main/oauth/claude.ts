/**
 * Claude subscription sign-in (Claude Code's public PKCE client).
 *
 * The callback page shows a code the user pastes back. There is no device-code
 * grant. Inference uses the same Messages API as an API key, with
 * `anthropic-beta: oauth-2025-04-20` and a bearer token.
 */

import { codeChallengeS256, randomString } from '../connections/pkce'

export const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
export const CLAUDE_AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
export const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
export const CLAUDE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
export const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20'
/** Same scope set Claude Code requests so one consent covers subscription inference. */
export const CLAUDE_SCOPES = [
  'org:create_api_key',
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload'
].join(' ')

export interface ClaudeLoginStart {
  url: string
  verifier: string
  state: string
}

export interface ClaudeTokens {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  email?: string
}

type FetchFn = typeof fetch

export function startClaudeLogin(): ClaudeLoginStart {
  const verifier = randomString()
  const state = randomString()
  const url = new URL(CLAUDE_AUTHORIZE_URL)
  url.searchParams.set('code', 'true')
  url.searchParams.set('client_id', CLAUDE_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', CLAUDE_REDIRECT_URI)
  url.searchParams.set('scope', CLAUDE_SCOPES)
  url.searchParams.set('code_challenge', codeChallengeS256(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return { url: url.toString(), verifier, state }
}

/** Accept `code#state`, a raw code, or the callback URL. */
export function parseClaudeCallback(raw: string): { code: string; state?: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { code: '' }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      return {
        code: u.searchParams.get('code') || '',
        state: u.searchParams.get('state') || undefined
      }
    } catch {
      return { code: '' }
    }
  }
  const hash = trimmed.indexOf('#')
  if (hash === -1) return { code: trimmed }
  return { code: trimmed.slice(0, hash).trim(), state: trimmed.slice(hash + 1).trim() || undefined }
}

function emailFrom(json: Record<string, unknown>): string | undefined {
  const account = json.account
  if (account && typeof account === 'object') {
    const email = (account as { email_address?: unknown; email?: unknown }).email_address
      ?? (account as { email?: unknown }).email
    if (typeof email === 'string' && email.trim()) return email
  }
  return typeof json.email === 'string' ? json.email : undefined
}

export function parseClaudeTokens(json: Record<string, unknown>): ClaudeTokens {
  const accessToken = String(json.access_token || '')
  if (!accessToken) throw new Error('Claude did not return an access token')
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 8 * 60 * 60
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresIn,
    email: emailFrom(json)
  }
}

async function postToken(fetchFn: FetchFn, body: Record<string, string>, signal?: AbortSignal): Promise<ClaudeTokens> {
  let res: Response
  try {
    res = await fetchFn(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    throw new Error(`Could not reach platform.claude.com: ${err instanceof Error ? err.message : String(err)}`)
  }
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = { error: text.slice(0, 200) }
  }
  if (res.status < 200 || res.status >= 300 || !json.access_token) {
    const desc = json.error_description ?? json.error ?? json.message
    const message = typeof desc === 'string' && desc.trim() ? desc : `Claude token exchange failed (${res.status})`
    throw new Error(message)
  }
  return parseClaudeTokens(json)
}

export function exchangeClaudeCode(
  fetchFn: FetchFn,
  opts: { code: string; verifier: string; state: string },
  signal?: AbortSignal
): Promise<ClaudeTokens> {
  return postToken(
    fetchFn,
    {
      grant_type: 'authorization_code',
      client_id: CLAUDE_CLIENT_ID,
      code: opts.code,
      redirect_uri: CLAUDE_REDIRECT_URI,
      code_verifier: opts.verifier,
      state: opts.state
    },
    signal
  )
}

export function refreshClaudeToken(fetchFn: FetchFn, refreshToken: string, signal?: AbortSignal): Promise<ClaudeTokens> {
  return postToken(
    fetchFn,
    { grant_type: 'refresh_token', client_id: CLAUDE_CLIENT_ID, refresh_token: refreshToken },
    signal
  )
}
