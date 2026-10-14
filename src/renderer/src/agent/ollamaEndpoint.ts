/**
 * Configurable Ollama endpoint. The user-facing value is the server root
 * (http://host:11434); providers store `ollamaApiBase(root)` as `baseUrl` so
 * model listing, chat, probes and headless all use the same field.
 */

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

export type OllamaUrlResult = { ok: true; url: string } | { ok: false; error: string }

export function validateOllamaUrl(input: string): OllamaUrlResult {
  const raw = (input || '').trim()
  if (!raw) return { ok: false, error: 'Enter the Ollama server address, e.g. http://192.168.0.10:11434.' }
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(raw)
  if (!m) return { ok: false, error: 'Start the address with http:// or https://.' }
  if (!/^https?$/i.test(m[1])) return { ok: false, error: 'Only http:// and https:// addresses are supported.' }
  const authority = m[2]
  if (authority.includes('@')) return { ok: false, error: 'Do not put a username or password in the address.' }
  const host = authority.replace(/:[^:\]]*$/, '')
  if (!host) return { ok: false, error: 'The address is missing a host name or IP.' }
  const port = /:([^:\]]*)$/.exec(authority)?.[1]
  if (port !== undefined && (!/^\d+$/.test(port) || +port < 1 || +port > 65535)) {
    return { ok: false, error: 'The port must be a number between 1 and 65535.' }
  }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, error: 'That is not a valid address. Check the host name or IP.' }
  }
  if (u.search || u.hash) return { ok: false, error: 'Remove the query string or # fragment from the address.' }
  const path = u.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '')
  return { ok: true, url: u.origin + path }
}

export function ollamaApiBase(url: string): string {
  return `${url}/v1`
}

export function isOllamaProvider(p: { name?: string; baseUrl?: string }): boolean {
  return /^ollama/i.test(p.name || '') || /:11434(?:[/?#]|$)/.test(p.baseUrl || '')
}

/** Fills a missing/empty baseUrl on Ollama providers; returns a new array. Idempotent. */
export function migrateOllamaProviders<T extends { name?: string; baseUrl?: string }>(providers: T[]): T[] {
  return providers.map((p) =>
    isOllamaProvider(p) && !(p.baseUrl || '').trim() ? { ...p, baseUrl: ollamaApiBase(DEFAULT_OLLAMA_URL) } : p
  )
}
