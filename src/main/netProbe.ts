/**
 * Main-process reachability checks. Electron-free so headless can call them.
 * probeUrl returns status or a cause code only — never headers or a body.
 * connectCheck stops at TCP (and the TLS handshake for https).
 */

import net from 'node:net'
import tls from 'node:tls'

export type ConnectCheckResult = { ok: true; ms: number } | { ok: false; code: string }

/** TCP connect, plus TLS handshake for https. The socket is always destroyed. */
export async function connectCheck(url: string, timeoutMs: number): Promise<ConnectCheckResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, code: 'EINVALIDURL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'EINVALIDURL' }
  }
  const host = parsed.hostname
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, code: 'EINVALIDURL' }
  }
  // setTimeout delay must stay in the signed 32-bit range or it fires immediately.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    return { ok: false, code: 'EINVAL' }
  }

  const secure = parsed.protocol === 'https:'
  const started = Date.now()
  const socket = secure
    ? tls.connect({ host, port, ...(net.isIP(host) ? {} : { servername: host }) })
    : net.connect({ host, port })

  return new Promise((resolve) => {
    let done = false
    const finish = (result: ConnectCheckResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, code: 'UND_ERR_CONNECT_TIMEOUT' }), timeoutMs)
    socket.once('error', (err: NodeJS.ErrnoException) => {
      finish({ ok: false, code: typeof err.code === 'string' && err.code ? err.code : 'ECONNRESET' })
    })
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      finish({ ok: true, ms: Math.max(0, Date.now() - started) })
    })
  })
}

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
