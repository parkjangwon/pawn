/**
 * xAI (Grok) OAuth device-code flow.
 *
 * The client id is the public Grok CLI client. xAI allowlists it and does not
 * issue desktop client secrets, so there is nothing to inject at build time.
 * Refresh tokens stay in the main process; callers only receive an access token.
 */

export const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access'
export const XAI_DEVICE_URL = 'https://auth.x.ai/oauth2/device/code'
export const XAI_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
export const XAI_USERINFO_URL = 'https://auth.x.ai/oauth2/userinfo'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export interface XaiDeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  intervalMs: number
}

export interface XaiTokens {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export type XaiPoll =
  | { kind: 'tokens'; tokens: XaiTokens }
  | { kind: 'pending'; slowDown: boolean }
  | { kind: 'error'; message: string }

type FetchFn = typeof fetch

async function postForm(
  fetchFn: FetchFn,
  url: string,
  body: Record<string, string>,
  signal?: AbortSignal
): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body),
      signal
    })
  } catch (err) {
    throw new Error(`Could not reach ${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = { error: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

function errorText(json: Record<string, unknown>, fallback: string): string {
  const desc = json.error_description ?? json.error ?? json.message
  return typeof desc === 'string' && desc.trim() ? desc : fallback
}

export function parseDeviceCode(json: Record<string, unknown>): XaiDeviceCode {
  const deviceCode = String(json.device_code || '')
  const userCode = String(json.user_code || '')
  const verificationUri = String(json.verification_uri || '')
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error('xAI did not return a device code')
  }
  const complete = typeof json.verification_uri_complete === 'string' ? json.verification_uri_complete : verificationUri
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 300
  const interval = typeof json.interval === 'number' ? json.interval : 5
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: complete,
    expiresIn,
    intervalMs: Math.max(1, interval) * 1000
  }
}

export function parseTokens(json: Record<string, unknown>): XaiTokens {
  const accessToken = String(json.access_token || '')
  if (!accessToken) throw new Error('xAI did not return an access token')
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : undefined
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return { accessToken, refreshToken: refresh, expiresIn }
}

/** One poll response. `authorization_pending` and `slow_down` are not failures. */
export function interpretPoll(status: number, json: Record<string, unknown>): XaiPoll {
  if (status >= 200 && status < 300 && json.access_token) {
    return { kind: 'tokens', tokens: parseTokens(json) }
  }
  const code = typeof json.error === 'string' ? json.error : ''
  if (code === 'authorization_pending') return { kind: 'pending', slowDown: false }
  if (code === 'slow_down') return { kind: 'pending', slowDown: true }
  return { kind: 'error', message: errorText(json, `xAI sign-in failed (${status})`) }
}

export async function requestDeviceCode(fetchFn: FetchFn, signal?: AbortSignal): Promise<XaiDeviceCode> {
  const { status, json } = await postForm(
    fetchFn,
    XAI_DEVICE_URL,
    { client_id: XAI_CLIENT_ID, scope: XAI_SCOPE },
    signal
  )
  if (status < 200 || status >= 300) throw new Error(errorText(json, `xAI device code failed (${status})`))
  return parseDeviceCode(json)
}

export async function pollDeviceToken(
  fetchFn: FetchFn,
  deviceCode: string,
  signal?: AbortSignal
): Promise<XaiPoll> {
  const { status, json } = await postForm(
    fetchFn,
    XAI_TOKEN_URL,
    { grant_type: DEVICE_GRANT, client_id: XAI_CLIENT_ID, device_code: deviceCode },
    signal
  )
  return interpretPoll(status, json)
}

export async function refreshAccessToken(
  fetchFn: FetchFn,
  refreshToken: string,
  signal?: AbortSignal
): Promise<XaiTokens> {
  const { status, json } = await postForm(
    fetchFn,
    XAI_TOKEN_URL,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: XAI_CLIENT_ID },
    signal
  )
  if (status < 200 || status >= 300 || !json.access_token) {
    throw new Error(errorText(json, `xAI token refresh failed (${status})`))
  }
  return parseTokens(json)
}

export async function fetchUserEmail(fetchFn: FetchFn, accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const res = await fetchFn(XAI_USERINFO_URL, {
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
