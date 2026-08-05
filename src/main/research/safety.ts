/**
 * SSRF / redirect safety for agent-facing fetchers.
 * Port of insane-search engine/safety.py (MIT).
 */
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

export function allowPrivateDefault(): boolean {
  const v = process.env.PAWN_RESEARCH_ALLOW_PRIVATE || process.env.INSANE_ALLOW_PRIVATE || ''
  return v === '1' || v === 'true' || v === 'yes'
}

function ipBlocked(ipStr: string): boolean {
  // Node isIP returns 4 or 6 or 0
  if (!isIP(ipStr)) return false
  // Block private / loopback / link-local / reserved ranges via simple checks
  if (ipStr === '0.0.0.0' || ipStr === '::' || ipStr === '::1') return true
  if (ipStr.startsWith('127.')) return true
  if (ipStr.startsWith('10.')) return true
  if (ipStr.startsWith('192.168.')) return true
  if (ipStr.startsWith('169.254.')) return true
  // 172.16.0.0 – 172.31.255.255
  const m172 = /^172\.(\d+)\./.exec(ipStr)
  if (m172) {
    const n = Number(m172[1])
    if (n >= 16 && n <= 31) return true
  }
  // IPv6 unique-local / link-local
  const lower = ipStr.toLowerCase()
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true
  return false
}

export async function classifyUrl(
  url: string,
  allowPrivate = allowPrivateDefault()
): Promise<{ safe: boolean; reason: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (e) {
    return { safe: false, reason: `parse_error:${e instanceof Error ? e.message : String(e)}` }
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { safe: false, reason: `scheme:${parsed.protocol || 'none'}` }
  }
  const host = parsed.hostname
  if (!host) return { safe: false, reason: 'no_host' }
  if (allowPrivate) return { safe: true, reason: 'allow_private' }

  if (isIP(host)) {
    return ipBlocked(host)
      ? { safe: false, reason: `ip_blocked:${host}` }
      : { safe: true, reason: 'public_ip' }
  }

  try {
    const records = await lookup(host, { all: true })
    for (const r of records) {
      if (ipBlocked(r.address)) {
        return { safe: false, reason: `resolves_internal:${host}->${r.address}` }
      }
    }
  } catch {
    // Resolver hiccup — allow; the real request will fail naturally
    return { safe: true, reason: 'resolve_failed_allow' }
  }
  return { safe: true, reason: 'public' }
}

export function resolveRedirect(baseUrl: string, location: string): string {
  return new URL(location, baseUrl).href
}
