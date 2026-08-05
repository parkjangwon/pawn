/**
 * HTTP transport for the research engine.
 * Uses global fetch (Node 20+ / Electron Chromium when available).
 * Manual redirect handling so SSRF checks run on every hop.
 */
import { classifyUrl, resolveRedirect, allowPrivateDefault } from './safety'
import type { RawResponse } from './types'

const MAX_REDIRECTS = 10

export type Identity = 'chrome' | 'safari' | 'firefox' | 'mobile_safari' | 'mobile_chrome'

const IDENTITIES: Record<
  Identity,
  { ua: string; accept: string; acceptLanguage: string; secChUa?: string }
> = {
  chrome: {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9,ko;q=0.8',
    secChUa: '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"'
  },
  safari: {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9,ko;q=0.8'
  },
  firefox: {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9,ko;q=0.8'
  },
  mobile_safari: {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9,ko;q=0.8'
  },
  mobile_chrome: {
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9,ko;q=0.8',
    secChUa: '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"'
  }
}

export function refererValue(strategy: string, url: string): string | undefined {
  try {
    const u = new URL(url)
    if (strategy === 'none') return undefined
    if (strategy === 'self_root') return `${u.protocol}//${u.host}/`
    if (strategy === 'google_search') {
      return `https://www.google.com/search?q=${encodeURIComponent(u.hostname)}`
    }
    if (strategy === 'self') return url
    return strategy || undefined
  } catch {
    return undefined
  }
}

export async function httpGet(
  url: string,
  opts: {
    identity?: Identity
    refererStrategy?: string
    timeoutMs?: number
    accept?: string
    extraHeaders?: Record<string, string>
  } = {}
): Promise<{ resp: RawResponse | null; error?: string }> {
  const identity = opts.identity || 'chrome'
  const id = IDENTITIES[identity] || IDENTITIES.chrome
  const timeoutMs = opts.timeoutMs ?? 20_000
  const allowPrivate = allowPrivateDefault()

  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safety = await classifyUrl(current, allowPrivate)
    if (!safety.safe) {
      return { resp: null, error: `ssrf_blocked:${safety.reason}` }
    }

    const headers: Record<string, string> = {
      'User-Agent': id.ua,
      Accept: opts.accept || id.accept,
      'Accept-Language': id.acceptLanguage,
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1'
    }
    if (id.secChUa) {
      headers['sec-ch-ua'] = id.secChUa
      headers['sec-ch-ua-mobile'] = identity.startsWith('mobile') ? '?1' : '?0'
      headers['sec-ch-ua-platform'] = identity.startsWith('mobile') ? '"Android"' : '"macOS"'
    }
    const ref = refererValue(opts.refererStrategy || 'none', current)
    if (ref) headers.Referer = ref
    if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(current, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal
      })
      const status = res.status
      const loc = res.headers.get('location')
      if ([301, 302, 303, 307, 308].includes(status) && loc) {
        current = resolveRedirect(current, loc)
        continue
      }

      const buf = new Uint8Array(await res.arrayBuffer())
      // Cap body size ~5MB
      const capped = buf.byteLength > 5 * 1024 * 1024 ? buf.slice(0, 5 * 1024 * 1024) : buf
      const text = new TextDecoder('utf-8', { fatal: false }).decode(capped)
      const hdrs: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        hdrs[k.toLowerCase()] = v
      })

      return {
        resp: {
          url: current,
          status,
          headers: hdrs,
          text,
          bytes: capped
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('abort')) return { resp: null, error: 'timeout' }
      return { resp: null, error: msg }
    } finally {
      clearTimeout(timer)
    }
  }
  return { resp: null, error: 'too_many_redirects' }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
