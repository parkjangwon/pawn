/**
 * Domain-agnostic URL transforms for the fetch grid.
 * Port of insane-search engine/url_transforms.py (MIT).
 */

function replaceHost(url: string, newHost: string): string {
  const u = new URL(url)
  u.host = newHost
  return u.href
}

function original(url: string): string | null {
  return url
}

function mobileSubdomain(url: string): string | null {
  const u = new URL(url)
  const host = u.hostname
  if (!host.startsWith('www.')) return null
  const port = u.port ? `:${u.port}` : ''
  return replaceHost(url, `m.${host.slice(4)}${port}`)
}

function amPrefix(url: string): string | null {
  const u = new URL(url)
  const host = u.hostname
  if (!host || host.startsWith('m.')) return null
  // apex-like hosts only (≤2 labels after optional www)
  if (host.startsWith('www.')) return null
  if (host.split('.').length > 2) return null
  return replaceHost(url, `m.${host}`)
}

function dropWww(url: string): string | null {
  const u = new URL(url)
  const host = u.hostname
  if (!host.startsWith('www.')) return null
  return replaceHost(url, host.slice(4) + (u.port ? `:${u.port}` : ''))
}

/** Append .rss / .json feed variants for path-based content pages. */
function rssSuffix(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.pathname.endsWith('.rss') || u.pathname.endsWith('.json')) return null
    const base = u.href.split('?')[0].replace(/\/$/, '')
    if (/\/comments\//.test(base) || /\/r\//.test(base)) {
      return base.includes('/comments/') ? `${base}.rss` : `${base}/.rss`
    }
    return null
  } catch {
    return null
  }
}

function jsonSuffix(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.pathname.endsWith('.json')) return null
    const base = u.href.split('?')[0].replace(/\/$/, '')
    if (/\/comments\//.test(base) || /\/r\//.test(base)) {
      return base.includes('/comments/') ? `${base}.json` : `${base}/.json`
    }
    return null
  } catch {
    return null
  }
}

/** Jina Reader proxy — public no-key reader. */
function jinaReader(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('jina.ai')) return null
    return `https://r.jina.ai/${url}`
  } catch {
    return null
  }
}

const TRANSFORMS: Record<string, (url: string) => string | null> = {
  original,
  mobile_subdomain: mobileSubdomain,
  am_prefix: amPrefix,
  drop_www: dropWww,
  rss_suffix: rssSuffix,
  json_suffix: jsonSuffix,
  jina_reader: jinaReader
}

export function applyTransform(name: string, url: string): string | null {
  const fn = TRANSFORMS[name]
  if (!fn) throw new Error(`Unknown transform: ${name}`)
  return fn(url)
}

export function iterTransformed(url: string, order: string[]): Array<[string, string]> {
  const seen = new Set<string>()
  const out: Array<[string, string]> = []
  for (const name of order) {
    let newUrl: string | null
    try {
      newUrl = applyTransform(name, url)
    } catch {
      continue
    }
    if (newUrl == null || seen.has(newUrl)) continue
    seen.add(newUrl)
    out.push([name, newUrl])
  }
  return out
}

export const DEFAULT_TRANSFORM_ORDER = [
  'original',
  'drop_www',
  'mobile_subdomain',
  'am_prefix',
  'rss_suffix',
  'json_suffix'
]
