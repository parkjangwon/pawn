/**
 * Renderer Content-Security-Policy strings, kept in one place so tests can
 * pin the invariants.
 *
 * `script-src` must include `blob:`: the mods runtime dynamically imports
 * hooks modules from blob: URLs created in the renderer
 * (src/renderer/src/agent/mods/runtime.ts). Without it every mod silently
 * fails to load in packaged builds.
 *
 * img-src must never gain a remote source: a markdown image URL would be a
 * zero-click exfil channel.
 */
/** Exact http origins safe to append to connect-src. Drops https, wildcards, credentials, garbage. */
export function httpConnectOrigins(inputs: string[]): string[] {
  const extra = new Set<string>()
  for (const o of inputs) {
    try {
      const u = new URL(o)
      if (u.protocol === 'http:' && u.hostname && !u.username && !u.password && !/[*\s;,]/.test(u.host)) extra.add(u.origin)
    } catch { /* invalid origin: skip */ }
  }
  return Array.from(extra)
}

function connectSrc(base: string, extraConnectOrigins: string[]): string {
  const extra = httpConnectOrigins(extraConnectOrigins).map((o) => ' ' + o).join('')
  return `${base}${extra};`
}

/**
 * Dev CSP. `extraConnectOrigins` are exact http origins (e.g. a LAN Ollama
 * server) appended to connect-src only.
 */
export function buildDevCsp(extraConnectOrigins: string[]): string {
  return [
    "default-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:* ws://localhost:*;",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://localhost:*;",
    "style-src 'self' 'unsafe-inline' http://localhost:*;",
    "img-src 'self' data: blob: http://localhost:*;",
    "font-src 'self' http://localhost:*;",
    connectSrc("connect-src 'self' https: http://localhost:* ws://localhost:*", extraConnectOrigins)
  ].join(' ')
}

export const DEV_CSP = buildDevCsp([])

/**
 * Production CSP. `extraConnectOrigins` are exact http origins (e.g. a LAN
 * Ollama server) appended to connect-src only; invalid entries are dropped,
 * wildcards are never produced, and img-src is untouched.
 */
export function buildProdCsp(extraConnectOrigins: string[]): string {
  return [
    "default-src 'self';",
    "script-src 'self' blob:;",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data: blob:;",
    "font-src 'self';",
    connectSrc("connect-src 'self' https: http://localhost:* http://127.0.0.1:*", extraConnectOrigins)
  ].join(' ')
}

export const PROD_CSP = buildProdCsp([])
