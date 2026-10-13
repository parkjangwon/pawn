/**
 * One-shot HTTP reachability check. Electron-free so headless can call it.
 * Returns status or a cause code only — never headers or a body.
 */

export async function probeUrl(
  url: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; status?: number; code?: string; message?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, code: 'EINVALIDURL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'EINVALIDURL' }
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      credentials: 'omit'
    })
    await res.body?.cancel().catch(() => {})
    return { ok: true, status: res.status }
  } catch (err) {
    const cause = (err as { cause?: unknown } | null)?.cause
    const c = cause && typeof cause === 'object' ? (cause as { code?: unknown; message?: unknown; name?: unknown }) : undefined
    const causeCode = typeof c?.code === 'string' && c.code ? c.code : undefined
    const causeMessage = typeof c?.message === 'string' ? c.message : ''
    // undici rejects Chromium-unsafe ports with cause "bad port" and no code.
    const badPort = causeMessage.toLowerCase().includes('bad port')
    const timedOut =
      (err instanceof Error && err.name === 'TimeoutError') || c?.name === 'TimeoutError'
    const code = causeCode || (badPort ? 'EBADPORT' : undefined) || (timedOut ? 'ETIMEDOUT' : undefined)
    const message = causeMessage.replace(/\s+/g, ' ').trim().slice(0, 180)
    return { ok: false, ...(code ? { code } : {}), ...(message ? { message } : {}) }
  }
}
