/**
 * SSRF / redirect safety for agent-facing fetchers.
 * Port of insane-search engine/safety.py (MIT).
 */
import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

export function allowPrivateDefault(): boolean {
  const v = process.env.PAWN_RESEARCH_ALLOW_PRIVATE || process.env.INSANE_ALLOW_PRIVATE || ''
  return v === '1' || v === 'true' || v === 'yes'
}

// Non-public ranges. BlockList also matches IPv4-mapped IPv6 (::ffff:a.b.c.d)
// against the IPv4 subnets, which string prefix checks missed.
const BLOCKED = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local / cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved + broadcast
] as const) {
  BLOCKED.addSubnet(net, bits, 'ipv4')
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can reach IPv4 internals
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8] // multicast
] as const) {
  BLOCKED.addSubnet(net, bits, 'ipv6')
}

/** Strip URL brackets: new URL('http://[::1]/').hostname === '[::1]'. */
function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

export function ipBlocked(ipStr: string): boolean {
  const ip = unbracket(ipStr)
  const family = isIP(ip)
  if (!family) return false
  const lower = ip.toLowerCase()
  // IPv4-compatible / mapped forms written in hex (::ffff:7f00:1, ::7f00:1).
  const mapped = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (mapped) {
    const hi = parseInt(mapped[1], 16)
    const lo = parseInt(mapped[2], 16)
    const v4 = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
    if (BLOCKED.check(v4, 'ipv4')) return true
  }
  return BLOCKED.check(ip, family === 4 ? 'ipv4' : 'ipv6')
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
  const host = unbracket(parsed.hostname)
  if (!host) return { safe: false, reason: 'no_host' }
  if (allowPrivate) return { safe: true, reason: 'allow_private' }

  if (isIP(host)) {
    return ipBlocked(host)
      ? { safe: false, reason: `ip_blocked:${host}` }
      : { safe: true, reason: 'public_ip' }
  }

  try {
    const records = await lookup(host, { all: true })
    if (records.length === 0) return { safe: false, reason: `resolve_empty:${host}` }
    for (const r of records) {
      if (ipBlocked(r.address)) {
        return { safe: false, reason: `resolves_internal:${host}->${r.address}` }
      }
    }
  } catch {
    // Fail closed: an unresolvable host has nothing to fetch, and allowing it
    // lets a second (attacker-timed) resolution land on an internal address.
    return { safe: false, reason: `resolve_failed:${host}` }
  }
  return { safe: true, reason: 'public' }
}

export function resolveRedirect(baseUrl: string, location: string): string {
  return new URL(location, baseUrl).href
}
