/**
 * Antigravity sign-in (Google Cloud Code OAuth used by the Antigravity IDE).
 *
 * The Google client id and secret are not stored in git. They come from
 * PAWN_ANTIGRAVITY_CLIENT_* , ~/.pawn/oauth-clients.json, or the build embed.
 * The redirect URI is fixed by that client registration, so the loopback port
 * cannot move.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'
import { EMBEDDED_OAUTH } from '../connections/oauthDefaults'
import { codeChallengeS256, randomString } from '../connections/pkce'

export const ANTIGRAVITY_PORT = 51121
export const ANTIGRAVITY_REDIRECT = `http://localhost:${ANTIGRAVITY_PORT}/oauth-callback`
export const ANTIGRAVITY_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const ANTIGRAVITY_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
export const ANTIGRAVITY_API_HOST = 'https://cloudcode-pa.googleapis.com'
export const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
]

export const ANTIGRAVITY_METADATA = {
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI'
}

export interface AntigravityLoginStart {
  url: string
  verifier: string
  state: string
}

export interface AntigravityTokens {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  email?: string
}

type FetchFn = typeof fetch

function antigravityClient(): { id: string; secret: string } {
  let fileId = ''
  let fileSecret = ''
  try {
    const path = join(getPawnDir(), 'oauth-clients.json')
    if (existsSync(path)) {
      const json = JSON.parse(readFileSync(path, 'utf8')) as {
        antigravityClientId?: string
        antigravityClientSecret?: string
      }
      fileId = json.antigravityClientId || ''
      fileSecret = json.antigravityClientSecret || ''
    }
  } catch {
    /* malformed override: fall through to env and the build embed */
  }
  const id = (process.env.PAWN_ANTIGRAVITY_CLIENT_ID || fileId || EMBEDDED_OAUTH.antigravityClientId || '').trim()
  const secret = (process.env.PAWN_ANTIGRAVITY_CLIENT_SECRET || fileSecret || EMBEDDED_OAUTH.antigravityClientSecret || '').trim()
  if (!id || !secret) {
    throw new Error(
      'Antigravity sign-in is not configured. Set PAWN_ANTIGRAVITY_CLIENT_ID and PAWN_ANTIGRAVITY_CLIENT_SECRET, or add antigravityClientId and antigravityClientSecret to ~/.pawn/oauth-clients.json.'
    )
  }
  return { id, secret }
}

export function startAntigravityLogin(): AntigravityLoginStart {
  const client = antigravityClient()
  const verifier = randomString()
  const state = randomString()
  const url = new URL(ANTIGRAVITY_AUTH_URL)
  url.searchParams.set('client_id', client.id)
  url.searchParams.set('redirect_uri', ANTIGRAVITY_REDIRECT)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '))
  url.searchParams.set('code_challenge', codeChallengeS256(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return { url: url.toString(), verifier, state }
}

function errorText(json: Record<string, unknown>, fallback: string): string {
  const err = json.error
  if (typeof err === 'string' && err.trim()) {
    const desc = json.error_description
    return typeof desc === 'string' && desc.trim() ? desc : err
  }
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

async function readJson(res: Response): Promise<{ status: number; json: Record<string, unknown> }> {
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = { error: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

export function parseGoogleTokens(json: Record<string, unknown>): AntigravityTokens {
  const accessToken = String(json.access_token || '')
  if (!accessToken) throw new Error('Antigravity did not return an access token')
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresIn
  }
}

/** Cloud Code returns the project as a string or `{ id }` under a few names. */
export function projectIdFromLoad(json: Record<string, unknown>): string | undefined {
  const keys = ['cloudaicompanionProject', 'project']
  for (const key of keys) {
    const value = json[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id
      if (typeof id === 'string' && id.trim()) return id.trim()
    }
  }
  return undefined
}

export function tierIdFromLoad(json: Record<string, unknown>): string | undefined {
  const current = json.currentTier
  if (current && typeof current === 'object') {
    const id = (current as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) return id
  }
  const allowed = json.allowedTiers
  if (Array.isArray(allowed)) {
    for (const tier of allowed) {
      if (tier && typeof tier === 'object') {
        const id = (tier as { id?: unknown }).id
        if (typeof id === 'string' && id.trim()) return id
      }
    }
  }
  return undefined
}

async function postForm(fetchFn: FetchFn, body: Record<string, string>, signal?: AbortSignal): Promise<AntigravityTokens> {
  let res: Response
  try {
    res = await fetchFn(ANTIGRAVITY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body),
      signal
    })
  } catch (err) {
    throw new Error(`Could not reach accounts.google.com: ${err instanceof Error ? err.message : String(err)}`)
  }
  const { status, json } = await readJson(res)
  if (status < 200 || status >= 300 || !json.access_token) {
    throw new Error(errorText(json, `Antigravity token exchange failed (${status})`))
  }
  return parseGoogleTokens(json)
}

export function exchangeAntigravityCode(
  fetchFn: FetchFn,
  code: string,
  verifier: string,
  signal?: AbortSignal
): Promise<AntigravityTokens> {
  const client = antigravityClient()
  return postForm(
    fetchFn,
    {
      grant_type: 'authorization_code',
      client_id: client.id,
      client_secret: client.secret,
      code,
      redirect_uri: ANTIGRAVITY_REDIRECT,
      code_verifier: verifier
    },
    signal
  )
}

export function refreshAntigravityToken(
  fetchFn: FetchFn,
  refreshToken: string,
  signal?: AbortSignal
): Promise<AntigravityTokens> {
  const client = antigravityClient()
  return postForm(
    fetchFn,
    {
      grant_type: 'refresh_token',
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refreshToken
    },
    signal
  )
}

export async function fetchGoogleEmail(fetchFn: FetchFn, accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const res = await fetchFn(ANTIGRAVITY_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { email?: unknown }
    return typeof json.email === 'string' ? json.email : undefined
  } catch {
    return undefined
  }
}

async function postCloudCode(
  fetchFn: FetchFn,
  method: string,
  accessToken: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const res = await fetchFn(`${ANTIGRAVITY_API_HOST}/v1internal:${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })
  const { status, json } = await readJson(res)
  if (status < 200 || status >= 300) throw new Error(errorText(json, `Antigravity setup failed (${status})`))
  return json
}

/**
 * Resolve the Cloud Code project. A fresh account may need onboardUser once
 * before loadCodeAssist returns an id.
 */
export async function resolveProjectId(fetchFn: FetchFn, accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
  const loaded = await postCloudCode(fetchFn, 'loadCodeAssist', accessToken, { metadata: ANTIGRAVITY_METADATA }, signal)
  const existing = projectIdFromLoad(loaded)
  if (existing) return existing
  const tier = tierIdFromLoad(loaded) || 'free-tier'
  let onboard = await postCloudCode(
    fetchFn,
    'onboardUser',
    accessToken,
    { tierId: tier, metadata: ANTIGRAVITY_METADATA, cloudaicompanionProject: '' },
    signal
  )
  for (let i = 0; i < 5 && onboard.done === false; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (signal?.aborted) return undefined
    onboard = await postCloudCode(
      fetchFn,
      'onboardUser',
      accessToken,
      { tierId: tier, metadata: ANTIGRAVITY_METADATA, cloudaicompanionProject: projectIdFromLoad(onboard) || '' },
      signal
    )
  }
  return projectIdFromLoad(onboard) || projectIdFromLoad(
    await postCloudCode(fetchFn, 'loadCodeAssist', accessToken, { metadata: ANTIGRAVITY_METADATA }, signal)
  )
}
