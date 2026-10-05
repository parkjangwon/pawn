/** Real HTTP for mods. http(s) only, bounded body, no research-page scraping. */

const MAX_REQUEST = 1_000_000
const MAX_RESPONSE = 2_000_000
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

export interface ModHttpInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface ModHttpResult {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
  error?: string
}

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (Object.keys(out).length >= 40) return
    out[key] = value.slice(0, 4096)
  })
  return out
}

export async function modHttpFetch(
  url: string,
  init?: ModHttpInit,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ModHttpResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { status: 0, ok: false, headers: {}, text: '', error: 'Invalid URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 0, ok: false, headers: {}, text: '', error: 'Only http and https URLs are allowed' }
  }
  const method = String(init?.method || 'GET').toUpperCase()
  if (!METHODS.has(method)) {
    return { status: 0, ok: false, headers: {}, text: '', error: `Method not allowed: ${method}` }
  }
  const headers: Record<string, string> = {}
  if (init?.headers && typeof init.headers === 'object') {
    for (const [k, v] of Object.entries(init.headers)) {
      if (Object.keys(headers).length >= 40) break
      if (!k || /[\r\n]/.test(k) || typeof v !== 'string' || /[\r\n]/.test(v)) continue
      headers[k] = v.slice(0, 4096)
    }
  }
  const body = typeof init?.body === 'string' ? init.body : undefined
  if (body && body.length > MAX_REQUEST) {
    return { status: 0, ok: false, headers: {}, text: '', error: 'Request body exceeds 1 MiB' }
  }
  if (body && (method === 'GET' || method === 'HEAD')) {
    return { status: 0, ok: false, headers: {}, text: '', error: `${method} does not take a body` }
  }
  const timeoutMs = Math.min(120_000, Math.max(1_000, Math.floor(Number(init?.timeoutMs) || 30_000)))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(parsed.toString(), {
      method,
      headers,
      body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
      redirect: 'follow',
      signal: controller.signal
    })
    const raw = await res.text()
    const text = raw.length > MAX_RESPONSE ? raw.slice(0, MAX_RESPONSE) : raw
    return {
      status: res.status,
      ok: res.ok,
      headers: headerMap(res.headers),
      text
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 0, ok: false, headers: {}, text: '', error: message }
  } finally {
    clearTimeout(timer)
  }
}
