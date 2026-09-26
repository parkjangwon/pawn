const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** Normalize a URL for shell.openExternal; only absolute http(s) is allowed. */
export function safeExternalUrl(rawUrl: unknown): string | null {
  const url = String(rawUrl || '').trim()
  if (!url) return null
  if (!SCHEME_RE.test(url)) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Return `raw` only when it parses as an absolute https URL, else `fallback`. */
export function httpsOrDefault(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return new URL(raw).protocol === 'https:' ? raw : fallback
  } catch {
    return fallback
  }
}

/**
 * True when `url` is the app's own renderer document. In dev that is the Vite
 * origin; in production it is the packaged index.html file URL. Query and hash
 * are ignored because the SPA routes with them.
 */
export function isAppRendererUrl(
  url: string | undefined | null,
  target: { devUrl?: string | null; fileUrl?: string | null }
): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (target.devUrl) {
    try {
      const dev = new URL(target.devUrl)
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === dev.origin) {
        return true
      }
    } catch {
      // fall through to the file check
    }
  }
  if (target.fileUrl && parsed.protocol === 'file:') {
    try {
      const file = new URL(target.fileUrl)
      return decodeURIComponent(parsed.pathname) === decodeURIComponent(file.pathname)
    } catch {
      return false
    }
  }
  return false
}
