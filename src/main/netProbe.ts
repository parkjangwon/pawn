/**
 * Main-process reachability checks. Electron-free so headless can call them.
 * probeUrl returns status or a cause code only — never headers or a body.
 * connectCheck stops at TCP (and the TLS handshake for https).
 */

import net from 'node:net'
import tls from 'node:tls'

export type ConnectCheckResult =
  | { ok: true; ms: number }
  | { ok: true; skipped: true; reason: 'proxy'; ms: 0 }
  | { ok: false; code: string }

const PROXY_SKIP: ConnectCheckResult = { ok: true, skipped: true, reason: 'proxy', ms: 0 }

function envValue(env: NodeJS.ProcessEnv, lower: string, upper: string): string | null {
  for (const key of [lower, upper]) {
    const value = env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** host:port, or [ipv6]:port. A port is present only when the suffix is all digits. */
function splitHostPort(entry: string): { host: string; port: number | null } {
  if (entry.startsWith('[')) {
    const end = entry.indexOf(']')
    if (end > 1) {
      const host = entry.slice(1, end)
      const rest = entry.slice(end + 1)
      if (rest === '') return { host, port: null }
      if (/^:\d+$/.test(rest)) return { host, port: Number(rest.slice(1)) }
    }
    return { host: entry, port: null }
  }
  const colon = entry.lastIndexOf(':')
  if (colon > 0 && entry.indexOf(':') === colon && /^\d+$/.test(entry.slice(colon + 1))) {
    return { host: entry.slice(0, colon), port: Number(entry.slice(colon + 1)) }
  }
  return { host: entry, port: null }
}

function noProxyCovers(url: URL, list: string): boolean {
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  const host = url.hostname.toLowerCase()
  for (const raw of list.split(/[\s,]+/)) {
    if (!raw) continue
    if (raw === '*') return true
    const rule = splitHostPort(raw)
    if (rule.port !== null && rule.port !== port) continue
    const name = (rule.host.startsWith('.') ? rule.host.slice(1) : rule.host).toLowerCase()
    if (!name) continue
    if (host === name || host.endsWith('.' + name)) return true
  }
  return false
}

/**
 * Proxy URL for this request. https_proxy/HTTPS_PROXY or http_proxy/HTTP_PROXY;
 * lowercase wins. Null when unset, or when no_proxy/NO_PROXY covers the host
 * ("*" all; ".example.com" and "example.com" match the host and subdomains;
 * an optional :port must match).
 */
export function envProxyFor(url: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const https = parsed.protocol === 'https:'
  if (!https && parsed.protocol !== 'http:') return null
  const proxy = https ? envValue(env, 'https_proxy', 'HTTPS_PROXY') : envValue(env, 'http_proxy', 'HTTP_PROXY')
  if (!proxy) return null
  const bypass = envValue(env, 'no_proxy', 'NO_PROXY')
  if (bypass && noProxyCovers(parsed, bypass)) return null
  return proxy
}

/** Electron resolveProxy list. Empty and "DIRECT" (any case) mean a direct dial. */
function resolvedProxyInUse(value: string): boolean {
  return value.split(';').some((part) => {
    const item = part.trim()
    return item !== '' && item.toUpperCase() !== 'DIRECT'
  })
}

/** TCP connect, plus TLS handshake for https. The socket is always destroyed. */
export async function connectCheck(
  url: string,
  timeoutMs: number,
  opts?: { env?: NodeJS.ProcessEnv; resolveProxy?: (url: string) => Promise<string> }
): Promise<ConnectCheckResult> {
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

  // A direct dial ignores the proxy and can hang until timeout on proxy-only networks.
  if (envProxyFor(url, opts?.env)) return PROXY_SKIP
  if (opts?.resolveProxy) {
    let via = ''
    try {
      via = await opts.resolveProxy(url)
    } catch {
      via = ''
    }
    if (resolvedProxyInUse(via)) return PROXY_SKIP
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
