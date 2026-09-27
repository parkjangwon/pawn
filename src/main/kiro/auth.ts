/**
 * Kiro credentials (pure Node — shared by the Electron main process and the
 * headless runner).
 *
 * Modes:
 *   builder-id  AWS Builder ID via the AWS SSO OIDC device flow. Pawn
 *               registers its OWN OIDC client (never reuses Kiro's), so its
 *               session cannot invalidate a Kiro IDE / CLI login.
 *   idc         IAM Identity Center (organization start URL + region), same
 *               device flow.
 *   api-key     Kiro API key (ksk_…) from app.kiro.dev (Pro and up).
 *   import      Read-only use of an existing Kiro CLI / IDE login. Pawn never
 *               refreshes those tokens (a refresh would rotate the refresh
 *               token and sign the other app out); it re-reads the source
 *               when the access token expires.
 */

import { existsSync, readFileSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'

export type KiroAuthMode = 'builder-id' | 'idc' | 'api-key' | 'import'

export const BUILDER_ID_START_URL = 'https://view.awsapps.com/start'
export const KIRO_SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
  'codewhisperer:transformations',
  'codewhisperer:taskassist'
]
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const REFRESH_EARLY_MS = 10 * 60_000

export interface KiroCredentials {
  mode: KiroAuthMode
  /** SSO / OIDC region (device flow) — may differ from the API region. */
  ssoRegion?: string
  /** Model API region. */
  region: string
  startUrl?: string
  clientId?: string
  clientSecret?: string
  clientSecretExpiresAt?: number
  accessToken?: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt?: number
  apiKey?: string
  profileArn?: string
  /** import: where the token came from. */
  importSource?: 'kiro-cli' | 'kiro-ide'
  /** Display only (e.g. Google, GitHub, BuilderId). */
  provider?: string
}

export interface KiroSecureStore {
  load(): Promise<KiroCredentials | null>
  save(creds: KiroCredentials | null): Promise<void>
}

export interface DeviceAuthStart {
  verificationUri: string
  verificationUriComplete: string
  userCode: string
  expiresIn: number
}

export interface KiroAccess {
  kind: 'bearer' | 'api-key'
  token: string
  region: string
  profileArn?: string
}

export interface KiroStatus {
  signedIn: boolean
  mode?: KiroAuthMode
  region?: string
  provider?: string
  importSource?: string
  expiresAt?: number
  profileArn?: string
  error?: string
}

type FetchFn = typeof fetch

export class KiroAuthError extends Error {
  constructor(
    message: string,
    readonly code: 'not_signed_in' | 'expired' | 'denied' | 'network' | 'invalid' = 'invalid'
  ) {
    super(message)
  }
}

function oidcBase(region: string): string {
  return `https://oidc.${region}.amazonaws.com`
}

function validRegion(r: unknown, fallback = 'us-east-1'): string {
  return typeof r === 'string' && /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(r) ? r : fallback
}

function regionFromArn(arn: string | undefined): string | undefined {
  const r = arn?.split(':')[3]
  return r && /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(r) ? r : undefined
}

async function postJson(fetchFn: FetchFn, url: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; json: Record<string, any> }> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Pawn' },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    throw new KiroAuthError(`Could not reach ${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`, 'network')
  }
  const text = await res.text()
  let json: Record<string, any> = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { error: 'invalid_response', error_description: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

// --- Kiro CLI / IDE import -------------------------------------------------------

export function kiroCliDbPaths(home = homedir()): string[] {
  const out = [join(home, '.local', 'share', 'kiro-cli', 'data.sqlite3')]
  if (platform() === 'darwin') out.unshift(join(home, 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3'))
  if (platform() === 'win32' && process.env.LOCALAPPDATA) out.unshift(join(process.env.LOCALAPPDATA, 'kiro-cli', 'data.sqlite3'))
  return out
}

export function kiroIdeTokenPath(home = homedir()): string {
  return join(home, '.aws', 'sso', 'cache', 'kiro-auth-token.json')
}

export type SqliteOpen = (path: string) => { prepare(sql: string): { get(...args: unknown[]): unknown }; close(): void }

/** Parse the token JSON of either source into credentials (no network). */
export function parseImportedToken(raw: Record<string, any>, source: 'kiro-cli' | 'kiro-ide', profileArn?: string): KiroCredentials | null {
  const accessToken = raw.access_token ?? raw.accessToken
  if (typeof accessToken !== 'string' || !accessToken) return null
  const expRaw = raw.expires_at ?? raw.expiresAt
  const expiresAt = typeof expRaw === 'string' ? Date.parse(expRaw) : typeof expRaw === 'number' ? expRaw : undefined
  const arn = (raw.profile_arn ?? raw.profileArn ?? profileArn) as string | undefined
  return {
    mode: 'import',
    importSource: source,
    accessToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    profileArn: arn,
    region: validRegion(raw.region ?? regionFromArn(arn)),
    provider: typeof raw.provider === 'string' ? raw.provider : typeof raw.authMethod === 'string' ? raw.authMethod : undefined
  }
}

/** Read the current Kiro CLI login (read-only). */
export function readKiroCliLogin(open: SqliteOpen | null, home = homedir()): KiroCredentials | null {
  if (!open) return null
  for (const path of kiroCliDbPaths(home)) {
    if (!existsSync(path)) continue
    let db: ReturnType<SqliteOpen> | null = null
    try {
      db = open(path)
      let token: Record<string, any> | null = null
      for (const key of ['kirocli:social:token', 'kirocli:odic:token', 'codewhisperer:odic:token']) {
        const row = db.prepare('SELECT value FROM auth_kv WHERE key = ?').get(key) as { value?: string } | undefined
        if (row?.value) {
          token = JSON.parse(row.value)
          break
        }
      }
      if (!token) continue
      let arn: string | undefined
      try {
        const st = db.prepare('SELECT value FROM state WHERE key = ?').get('api.codewhisperer.profile') as { value?: string } | undefined
        arn = st?.value ? (JSON.parse(st.value) as { arn?: string }).arn : undefined
      } catch {
        /* optional */
      }
      const creds = parseImportedToken(token, 'kiro-cli', arn)
      if (creds) return creds
    } catch {
      /* locked / corrupt — try the next */
    } finally {
      try {
        db?.close()
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

export function readKiroIdeLogin(home = homedir()): KiroCredentials | null {
  const path = kiroIdeTokenPath(home)
  if (!existsSync(path)) return null
  try {
    return parseImportedToken(JSON.parse(readFileSync(path, 'utf8')), 'kiro-ide')
  } catch {
    return null
  }
}

// --- Manager ---------------------------------------------------------------------

export class KiroAuth {
  private creds: KiroCredentials | null = null
  private loaded = false
  private refreshing: Promise<KiroCredentials> | null = null
  private pendingDevice: { cancel: () => void } | null = null
  private lastError: string | undefined

  constructor(
    private readonly store: KiroSecureStore,
    private readonly opts: { fetch?: FetchFn; sqlite?: SqliteOpen | null; home?: string; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
  ) {}

  private get fetchFn(): FetchFn {
    return this.opts.fetch ?? fetch
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      this.creds = await this.store.load()
    } catch {
      this.creds = null
    }
  }

  private async persist(): Promise<void> {
    await this.store.save(this.creds)
  }

  async status(): Promise<KiroStatus> {
    await this.ensureLoaded()
    const c = this.creds
    if (!c) return { signedIn: false, ...(this.lastError ? { error: this.lastError } : {}) }
    return {
      signedIn: true,
      mode: c.mode,
      region: c.region,
      ...(c.provider ? { provider: c.provider } : {}),
      ...(c.importSource ? { importSource: c.importSource } : {}),
      ...(c.expiresAt ? { expiresAt: c.expiresAt } : {}),
      ...(c.profileArn ? { profileArn: c.profileArn } : {}),
      ...(this.lastError ? { error: this.lastError } : {})
    }
  }

  async signOut(): Promise<void> {
    this.pendingDevice?.cancel()
    this.creds = null
    this.lastError = undefined
    this.loaded = true
    await this.persist()
  }

  async setApiKey(key: string, region?: string): Promise<KiroStatus> {
    const k = key.trim()
    if (!/^ksk_[A-Za-z0-9_\-]{8,}$/.test(k)) throw new KiroAuthError('A Kiro API key starts with "ksk_" (create one at app.kiro.dev → API Keys).', 'invalid')
    this.creds = { mode: 'api-key', apiKey: k, region: validRegion(region) }
    this.loaded = true
    this.lastError = undefined
    await this.persist()
    return this.status()
  }

  /** Use an existing Kiro CLI (preferred) or Kiro IDE login, read-only. */
  async importLogin(source: 'auto' | 'kiro-cli' | 'kiro-ide' = 'auto'): Promise<KiroStatus> {
    const creds =
      (source !== 'kiro-ide' ? readKiroCliLogin(this.opts.sqlite ?? null, this.opts.home) : null) ??
      (source !== 'kiro-cli' ? readKiroIdeLogin(this.opts.home) : null)
    if (!creds) {
      throw new KiroAuthError(
        source === 'kiro-ide'
          ? 'No Kiro IDE login found (~/.aws/sso/cache/kiro-auth-token.json). Sign in to the Kiro IDE first.'
          : 'No Kiro CLI or IDE login found. Run `kiro-cli login` (or sign in to the Kiro IDE) first.',
        'not_signed_in'
      )
    }
    this.creds = creds
    this.loaded = true
    this.lastError = undefined
    await this.persist()
    return this.status()
  }

  /**
   * Start the device flow; resolves once the browser step is shown. `done`
   * settles when the user finishes (or the code expires / is cancelled).
   */
  async startDeviceLogin(opts: { mode: 'builder-id' | 'idc'; startUrl?: string; region?: string; signal?: AbortSignal }): Promise<{ device: DeviceAuthStart; done: Promise<KiroStatus> }> {
    this.pendingDevice?.cancel()
    const ssoRegion = validRegion(opts.region)
    const startUrl = opts.mode === 'builder-id' ? BUILDER_ID_START_URL : String(opts.startUrl || '').trim()
    if (opts.mode === 'idc' && !/^https:\/\/[^\s/]+\/start\/?/.test(startUrl) && !/^https:\/\/[^\s]+$/.test(startUrl)) {
      throw new KiroAuthError('Enter your IAM Identity Center start URL (https://…/start).', 'invalid')
    }
    const base = oidcBase(ssoRegion)
    const reg = await postJson(this.fetchFn, `${base}/client/register`, {
      clientName: 'Pawn',
      clientType: 'public',
      scopes: KIRO_SCOPES,
      grantTypes: [DEVICE_GRANT, 'refresh_token']
    })
    if (reg.status >= 400 || !reg.json.clientId) throw new KiroAuthError(`Client registration failed: ${reg.json.error_description || reg.json.error || reg.status}`)
    const clientId = String(reg.json.clientId)
    const clientSecret = String(reg.json.clientSecret)
    const dev = await postJson(this.fetchFn, `${base}/device_authorization`, { clientId, clientSecret, startUrl })
    if (dev.status >= 400 || !dev.json.deviceCode) throw new KiroAuthError(`Device authorization failed: ${dev.json.error_description || dev.json.error || dev.status}`)
    const device: DeviceAuthStart = {
      verificationUri: String(dev.json.verificationUri || ''),
      verificationUriComplete: String(dev.json.verificationUriComplete || dev.json.verificationUri || ''),
      userCode: String(dev.json.userCode || ''),
      expiresIn: Number(dev.json.expiresIn) || 600
    }
    let cancelled = false
    const cancel = (): void => {
      cancelled = true
    }
    this.pendingDevice = { cancel }
    opts.signal?.addEventListener('abort', cancel, { once: true })
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const done = (async (): Promise<KiroStatus> => {
      let interval = (Number(dev.json.interval) || 5) * 1000
      const deadline = this.now() + device.expiresIn * 1000
      while (!cancelled && this.now() < deadline) {
        await sleep(interval)
        if (cancelled) break
        const tok = await postJson(this.fetchFn, `${base}/token`, {
          clientId,
          clientSecret,
          deviceCode: dev.json.deviceCode,
          grantType: DEVICE_GRANT
        })
        const err = tok.json.error
        if (!err && (tok.json.accessToken || tok.json.access_token)) {
          this.creds = {
            mode: opts.mode,
            ssoRegion,
            region: ssoRegion,
            startUrl,
            clientId,
            clientSecret,
            clientSecretExpiresAt: Number(reg.json.clientSecretExpiresAt) ? Number(reg.json.clientSecretExpiresAt) * 1000 : undefined,
            accessToken: String(tok.json.accessToken || tok.json.access_token),
            refreshToken: String(tok.json.refreshToken || tok.json.refresh_token || ''),
            expiresAt: this.now() + (Number(tok.json.expiresIn || tok.json.expires_in) || 3600) * 1000,
            provider: opts.mode === 'builder-id' ? 'AWS Builder ID' : 'IAM Identity Center'
          }
          this.loaded = true
          this.lastError = undefined
          await this.persist()
          this.pendingDevice = null
          return this.status()
        }
        if (err === 'authorization_pending') continue
        if (err === 'slow_down') {
          interval += 5000
          continue
        }
        this.pendingDevice = null
        if (err === 'expired_token') throw new KiroAuthError('The sign-in code expired. Start again.', 'expired')
        if (err === 'access_denied') throw new KiroAuthError('Sign-in was denied.', 'denied')
        throw new KiroAuthError(`Sign-in failed: ${tok.json.error_description || err || tok.status}`)
      }
      this.pendingDevice = null
      throw new KiroAuthError(cancelled ? 'Sign-in cancelled.' : 'The sign-in code expired. Start again.', cancelled ? 'denied' : 'expired')
    })()
    // Avoid an unhandled rejection when nobody awaits `done`.
    done.catch(() => {})
    return { device, done }
  }

  cancelDeviceLogin(): void {
    this.pendingDevice?.cancel()
    this.pendingDevice = null
  }

  /** Credentials for one request; refreshes / re-reads as needed. */
  async access(opts: { forceRefresh?: boolean } = {}): Promise<KiroAccess> {
    await this.ensureLoaded()
    let c = this.creds
    if (!c) throw new KiroAuthError('Not signed in to Kiro. Open Settings → Providers → Kiro to sign in.', 'not_signed_in')
    if (c.mode === 'api-key') return { kind: 'api-key', token: c.apiKey || '', region: c.region }
    const stale = !c.accessToken || !c.expiresAt || c.expiresAt - this.now() < (c.mode === 'import' ? 60_000 : REFRESH_EARLY_MS)
    if (stale || opts.forceRefresh) c = await this.refresh()
    return { kind: 'bearer', token: c.accessToken!, region: c.region, ...(c.profileArn ? { profileArn: c.profileArn } : {}) }
  }

  private refresh(): Promise<KiroCredentials> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null
      })
    }
    return this.refreshing
  }

  private async doRefresh(): Promise<KiroCredentials> {
    const c = this.creds!
    if (c.mode === 'import') {
      // Never refresh another app's session — re-read what it wrote.
      const fresh = c.importSource === 'kiro-ide' ? readKiroIdeLogin(this.opts.home) : readKiroCliLogin(this.opts.sqlite ?? null, this.opts.home)
      if (fresh && fresh.accessToken && (!fresh.expiresAt || fresh.expiresAt > this.now() + 30_000)) {
        this.creds = { ...fresh }
        await this.persist()
        return this.creds
      }
      this.lastError = `The ${c.importSource === 'kiro-ide' ? 'Kiro IDE' : 'Kiro CLI'} login expired. Use ${c.importSource === 'kiro-ide' ? 'the Kiro IDE' : 'Kiro CLI (e.g. run `kiro-cli chat` once)'} to renew it, or sign in to Kiro in Pawn.`
      throw new KiroAuthError(this.lastError, 'expired')
    }
    if (!c.refreshToken || !c.clientId || !c.clientSecret) {
      this.lastError = 'Kiro session expired. Sign in again.'
      throw new KiroAuthError(this.lastError, 'expired')
    }
    const res = await postJson(this.fetchFn, `${oidcBase(c.ssoRegion || c.region)}/token`, {
      grantType: 'refresh_token',
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      refreshToken: c.refreshToken
    })
    const token = res.json.accessToken || res.json.access_token
    if (res.status >= 400 || !token) {
      const code = String(res.json.error || res.status)
      // invalid_grant / expired client registration → a new sign-in is required.
      this.lastError = `Kiro session could not be renewed (${code}). Sign in again.`
      throw new KiroAuthError(this.lastError, 'expired')
    }
    this.creds = {
      ...c,
      accessToken: String(token),
      refreshToken: String(res.json.refreshToken || res.json.refresh_token || c.refreshToken),
      expiresAt: this.now() + (Number(res.json.expiresIn || res.json.expires_in) || 3600) * 1000
    }
    this.lastError = undefined
    await this.persist()
    return this.creds
  }

  /** Remember a profile ARN discovered via ListAvailableProfiles. */
  async setProfileArn(arn: string): Promise<void> {
    if (!this.creds || !arn) return
    this.creds = { ...this.creds, profileArn: arn }
    await this.persist()
  }
}
