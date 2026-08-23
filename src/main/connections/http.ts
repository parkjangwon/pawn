/** Shared HTTP helpers for connection tools — never logs tokens. */

export function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.floor(v)))
}

export function truncate(text: string, max = 40_000): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n\n…(truncated, ${text.length - max} more chars)`
}

export async function fetchJson(
  url: string,
  init: RequestInit & { token: string; userAgent?: string }
): Promise<{ ok: boolean; status: number; body: unknown; text?: string }> {
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${init.token}`)
  if (init.userAgent) headers.set('User-Agent', init.userAgent)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  const { token: _t, userAgent: _u, ...rest } = init
  const signal = rest.signal || AbortSignal.timeout(30_000)
  const res = await fetch(url, { ...rest, signal, headers })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  }
  const text = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, body: { text }, text }
}

export function errMsg(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const msg =
      (typeof b.error === 'object' && b.error && (b.error as { message?: string }).message) ||
      (typeof b.message === 'string' && b.message) ||
      (typeof b.error === 'string' && b.error) ||
      (typeof b.error_description === 'string' && b.error_description)
    if (msg) return `${fallback} (${status}): ${msg}`
  }
  return `${fallback} (${status})`
}
