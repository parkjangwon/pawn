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
export const DEV_CSP = [
  "default-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:* ws://localhost:*;",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://localhost:*;",
  "style-src 'self' 'unsafe-inline' http://localhost:*;",
  "img-src 'self' data: blob: http://localhost:*;",
  "font-src 'self' http://localhost:*;",
  "connect-src 'self' https: http://localhost:* ws://localhost:*;"
].join(' ')

export const PROD_CSP = [
  "default-src 'self';",
  "script-src 'self' blob:;",
  "style-src 'self' 'unsafe-inline';",
  "img-src 'self' data: blob:;",
  "font-src 'self';",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*;"
].join(' ')
