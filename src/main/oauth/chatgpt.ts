/**
 * ChatGPT subscription sign-in (Codex device-code grant).
 *
 * The client id is the public Codex CLI client. OpenAI does not issue a
 * separate desktop secret for it. The access token is only valid at the
 * ChatGPT Codex responses endpoint, not at api.openai.com.
 */

export const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_DEVICE_CODE_URL = `${CHATGPT_ISSUER}/api/accounts/deviceauth/usercode`
export const CHATGPT_DEVICE_TOKEN_URL = `${CHATGPT_ISSUER}/api/accounts/deviceauth/token`
export const CHATGPT_OAUTH_TOKEN_URL = `${CHATGPT_ISSUER}/oauth/token`
export const CHATGPT_VERIFICATION_URL = `${CHATGPT_ISSUER}/codex/device`
export const CHATGPT_DEVICE_REDIRECT = `${CHATGPT_ISSUER}/deviceauth/callback`
export const CHATGPT_API_BASE = 'https://chatgpt.com/backend-api/codex'
/** Device-code grants live for 15 minutes in the Codex CLI. */
export const CHATGPT_DEVICE_TTL_SEC = 15 * 60

export interface ChatGptDevice {
  deviceAuthId: string
  userCode: string
  verificationUri: string
  expiresIn: number
  intervalMs: number
}

export interface ChatGptTokens {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn: number
  email?: string
  accountId?: string
}

export type ChatGptPoll =
  | { kind: 'code'; authorizationCode: string; codeVerifier: string }
  | { kind: 'pending' }
  | { kind: 'error'; message: string }

type FetchFn = typeof fetch

function errorText(json: Record<string, unknown>, fallback: string): string {
  const desc = json.error_description ?? json.detail ?? json.error ?? json.message
  if (typeof desc === 'string' && desc.trim()) return desc
  if (desc && typeof desc === 'object') {
    const nested = (desc as { message?: unknown }).message
    if (typeof nested === 'string' && nested.trim()) return nested
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

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  if (!part) return {}
  try {
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(pad, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** ChatGPT account id may sit at the top level or under the OpenAI auth claim. */
export function accountFromIdToken(idToken: string | undefined): { email?: string; accountId?: string } {
  if (!idToken) return {}
  const claims = decodeJwtPayload(idToken)
  const nested = claims['https://api.openai.com/auth']
  const nestedAccount =
    nested && typeof nested === 'object'
      ? (nested as { chatgpt_account_id?: unknown }).chatgpt_account_id
      : undefined
  const accountId =
    (typeof claims.chatgpt_account_id === 'string' && claims.chatgpt_account_id) ||
    (typeof nestedAccount === 'string' && nestedAccount) ||
    undefined
  const email = typeof claims.email === 'string' ? claims.email : undefined
  return { email, accountId }
}

export function parseDeviceStart(json: Record<string, unknown>): ChatGptDevice {
  const deviceAuthId = String(json.device_auth_id || json.deviceAuthId || '')
  const userCode = String(json.user_code || json.usercode || json.userCode || '')
  if (!deviceAuthId || !userCode) throw new Error('ChatGPT did not return a device code')
  const rawInterval = json.interval
  const seconds = typeof rawInterval === 'number' ? rawInterval : Number(rawInterval || 5)
  return {
    deviceAuthId,
    userCode,
    verificationUri: CHATGPT_VERIFICATION_URL,
    expiresIn: CHATGPT_DEVICE_TTL_SEC,
    intervalMs: Math.max(1, Number.isFinite(seconds) ? seconds : 5) * 1000
  }
}

/**
 * 403 and 404 mean the user has not finished yet (Codex treats both as pending).
 * A 200 body carries the authorization code plus a server-generated PKCE verifier.
 */
export function interpretDevicePoll(status: number, json: Record<string, unknown>): ChatGptPoll {
  if (status === 403 || status === 404) return { kind: 'pending' }
  const authorizationCode = typeof json.authorization_code === 'string' ? json.authorization_code : ''
  const codeVerifier = typeof json.code_verifier === 'string' ? json.code_verifier : ''
  if (status >= 200 && status < 300 && authorizationCode && codeVerifier) {
    return { kind: 'code', authorizationCode, codeVerifier }
  }
  return { kind: 'error', message: errorText(json, `ChatGPT sign-in failed (${status})`) }
}

export function parseOAuthTokens(json: Record<string, unknown>): ChatGptTokens {
  const accessToken = String(json.access_token || '')
  if (!accessToken) throw new Error('ChatGPT did not return an access token')
  const idToken = typeof json.id_token === 'string' ? json.id_token : undefined
  const identity = accountFromIdToken(idToken)
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    idToken,
    expiresIn,
    email: identity.email,
    accountId: identity.accountId
  }
}

export async function requestDeviceCode(fetchFn: FetchFn, signal?: AbortSignal): Promise<ChatGptDevice> {
  let res: Response
  try {
    res = await fetchFn(CHATGPT_DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID }),
      signal
    })
  } catch (err) {
    throw new Error(`Could not reach auth.openai.com: ${err instanceof Error ? err.message : String(err)}`)
  }
  const { status, json } = await readJson(res)
  if (status === 404) throw new Error('ChatGPT device-code sign-in is not enabled. Turn it on in ChatGPT security settings, or try again later.')
  if (status < 200 || status >= 300) throw new Error(errorText(json, `ChatGPT device code failed (${status})`))
  return parseDeviceStart(json)
}

export async function pollDeviceCode(
  fetchFn: FetchFn,
  deviceAuthId: string,
  userCode: string,
  signal?: AbortSignal
): Promise<ChatGptPoll> {
  const res = await fetchFn(CHATGPT_DEVICE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    signal
  })
  const { status, json } = await readJson(res)
  return interpretDevicePoll(status, json)
}

async function postTokenForm(fetchFn: FetchFn, body: Record<string, string>, signal?: AbortSignal): Promise<ChatGptTokens> {
  let res: Response
  try {
    res = await fetchFn(CHATGPT_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body),
      signal
    })
  } catch (err) {
    throw new Error(`Could not reach auth.openai.com: ${err instanceof Error ? err.message : String(err)}`)
  }
  const { status, json } = await readJson(res)
  if (status < 200 || status >= 300 || !json.access_token) {
    throw new Error(errorText(json, `ChatGPT token exchange failed (${status})`))
  }
  return parseOAuthTokens(json)
}

export function exchangeDeviceCode(
  fetchFn: FetchFn,
  authorizationCode: string,
  codeVerifier: string,
  signal?: AbortSignal
): Promise<ChatGptTokens> {
  return postTokenForm(
    fetchFn,
    {
      grant_type: 'authorization_code',
      client_id: CHATGPT_CLIENT_ID,
      code: authorizationCode,
      redirect_uri: CHATGPT_DEVICE_REDIRECT,
      code_verifier: codeVerifier
    },
    signal
  )
}

export function refreshAccessToken(fetchFn: FetchFn, refreshToken: string, signal?: AbortSignal): Promise<ChatGptTokens> {
  return postTokenForm(
    fetchFn,
    { grant_type: 'refresh_token', client_id: CHATGPT_CLIENT_ID, refresh_token: refreshToken },
    signal
  )
}
