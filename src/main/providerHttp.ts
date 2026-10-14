/**
 * Plain-http provider requests (LAN Ollama, a mock on 127.0.0.1, a self-hosted
 * gateway) run here in main instead of in the renderer. The renderer's CSP is
 * fixed when the document loads, so an origin saved later could not be reached
 * from the page without a reload. Main is not bound by that CSP, so this module
 * is the allowlist instead: a request goes out only when its origin belongs to
 * a provider that is saved in config right now.
 *
 * Electron-free; src/main/ipc/providerHttp.ts wires it to IPC with `net.fetch`.
 */

export interface ProviderHttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type TargetCheck = { ok: true; url: URL } | { ok: false; error: string }

/** Exact http origins of saved providers (credentials, non-http and garbage dropped). */
export function savedHttpOrigins(providers: Array<{ baseUrl?: unknown }> | undefined): Set<string> {
  const out = new Set<string>()
  for (const p of providers || []) {
    try {
      const u = new URL(String(p?.baseUrl || ''))
      if (u.protocol === 'http:' && u.hostname && !u.username && !u.password) out.add(u.origin)
    } catch {
      /* skip */
    }
  }
  return out
}

/** The renderer may only reach saved plain-http provider origins through main. */
export function checkProviderTarget(rawUrl: unknown, providers: Array<{ baseUrl?: unknown }> | undefined): TargetCheck {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8192) return { ok: false, error: 'invalid url' }
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'invalid url' }
  }
  if (u.protocol !== 'http:') return { ok: false, error: 'only http provider urls go through main' }
  if (u.username || u.password) return { ok: false, error: 'credentials in the url are not allowed' }
  if (!savedHttpOrigins(providers).has(u.origin)) return { ok: false, error: `origin ${u.origin} is not a saved provider` }
  return { ok: true, url: u }
}

const DROP_HEADERS = new Set(['host', 'cookie', 'cookie2', 'content-length', 'connection', 'origin', 'referer', 'proxy-authorization', 'transfer-encoding'])

export function sanitizeRequest(req: unknown): { ok: true; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string } | { ok: false; error: string } {
  const r = (req || {}) as ProviderHttpRequest
  const method = String(r.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') return { ok: false, error: `method ${method} not allowed` }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(r.headers && typeof r.headers === 'object' ? r.headers : {})) {
    const name = String(k).toLowerCase()
    if (DROP_HEADERS.has(name) || !/^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(name)) continue
    const value = String(v ?? '')
    if (/[\r\n]/.test(value) || value.length > 16_384) continue
    headers[name] = value
  }
  if (r.body !== undefined && typeof r.body !== 'string') return { ok: false, error: 'body must be a string' }
  if (typeof r.body === 'string' && r.body.length > 32 * 1024 * 1024) return { ok: false, error: 'body too large' }
  if (method === 'GET' && r.body) return { ok: false, error: 'GET with a body' }
  return { ok: true, method, headers, body: r.body }
}

export interface ProviderHttpSink {
  head: (status: number, statusText: string, headers: Array<[string, string]>) => void
  chunk: (data: Uint8Array) => void
  end: () => void
  error: (message: string) => void
}

export interface ProviderHttpDeps {
  /** Saved providers, read fresh for every request. */
  providers: () => Array<{ baseUrl?: unknown }> | undefined
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>
}

/**
 * Validate, send, and stream the response into `sink`. Resolves when the body
 * is done (or failed / aborted). Never throws; failures go to `sink.error`.
 */
export async function runProviderRequest(req: unknown, signal: AbortSignal, deps: ProviderHttpDeps, sink: ProviderHttpSink): Promise<void> {
  const target = checkProviderTarget((req as ProviderHttpRequest | undefined)?.url, deps.providers())
  if (!target.ok) return sink.error(`refused: ${target.error}`)
  const clean = sanitizeRequest(req)
  if (!clean.ok) return sink.error(`refused: ${clean.error}`)
  let res: Response
  try {
    // Redirects are returned as-is, never followed to an origin outside the list.
    res = await deps.fetch(target.url.toString(), { method: clean.method, headers: clean.headers, body: clean.body, signal, redirect: 'manual' })
  } catch (err) {
    return sink.error(signal.aborted ? 'aborted' : errorText(err))
  }
  const headers: Array<[string, string]> = []
  res.headers.forEach((v, k) => headers.push([k, v]))
  sink.head(res.status, res.statusText, headers)
  if (!res.body) return sink.end()
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength) sink.chunk(value)
    }
    sink.end()
  } catch (err) {
    sink.error(signal.aborted ? 'aborted' : errorText(err))
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
}

function errorText(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } }
  const msg = String(e?.message || err || 'request failed')
  const code = e?.cause?.code
  return code ? `${msg} (cause: ${code})` : msg
}
