/**
 * Mod custom views: a mod's own HTML + script in a sandboxed srcdoc iframe.
 *
 * - `sandbox="allow-scripts"` only: no allow-same-origin, so the view has an
 *   opaque origin and can't touch the app DOM, storage, `window.api` or cookies.
 * - The document starts with a strict meta CSP: no network, no frames, no forms,
 *   no remote images. Scripts run only with the per-process nonce (the app CSP
 *   is inherited, and only the bridge and the mod's `script` carry it).
 * - The view talks to Pawn only through postMessage. `pawn.call(method, ...args)`
 *   reaches a small allowlist of `$` calls, and only those this mod's source
 *   names literally (so consent already showed them).
 */
import type { ModsApi } from './types'

export type ModViewPlacement = 'panel' | 'tab' | 'modal'

export interface ModView {
  plugin: string
  id: string
  title: string
  placement: ModViewPlacement
  html: string
  script: string
  height?: number
  /** Bumped on every open() so the iframe reloads. */
  rev: number
}

export const VIEW_ID = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_VIEW_HTML = 256 * 1024
export const MAX_VIEW_SCRIPT = 256 * 1024

/** `$` calls a view may make. Each must also appear literally in the mod's source. */
export const VIEW_BRIDGE_METHODS = [
  'ui.toast',
  'ui.notice',
  'ui.status',
  'store.get',
  'store.set',
  'store.delete',
  'store.keys',
  'fs.read',
  'fs.list',
  'fs.exists',
  'http.fetch',
  'model.complete',
  'clock.now'
] as const

/** Theme tokens copied into the view so it can match light/dark. */
export const VIEW_TOKENS = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-hover',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--border-color',
  '--primary',
  '--on-primary',
  '--accent',
  '--danger',
  '--success',
  '--radius-sm',
  '--radius-md'
]

export function viewCsp(nonce: string): string {
  const scripts = nonce ? `'nonce-${nonce}'` : "'unsafe-inline'"
  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'"
  ].join('; ')
}

/** Runs inside the view. Keep it dependency-free and small. */
const BRIDGE = `(() => {
  const pending = new Map(); let seq = 0; const listeners = new Set();
  const post = (m) => parent.postMessage(Object.assign({ __pawnView: 1 }, m), '*');
  window.addEventListener('message', (ev) => {
    if (ev.source !== parent) return;
    const m = ev.data; if (!m || m.__pawnView !== 1) return;
    if (m.kind === 'reply') { const p = pending.get(m.seq); if (!p) return; pending.delete(m.seq); m.ok ? p.resolve(m.value) : p.reject(new Error(m.error)); }
    if (m.kind === 'message') for (const fn of listeners) { try { fn(m.data) } catch (e) { console.error(e) } }
  });
  const pawn = {
    call: (method, ...args) => new Promise((resolve, reject) => { const s = ++seq; pending.set(s, { resolve, reject }); post({ kind: 'call', seq: s, method: String(method), args }); }),
    send: (data) => post({ kind: 'send', data }),
    onMessage: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    resize: (height) => post({ kind: 'resize', height: Number(height) || 0 })
  };
  Object.defineProperty(window, 'pawn', { value: Object.freeze(pawn) });
})();`

function scriptSafe(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function buildViewDoc(opts: {
  html: string
  script: string
  nonce: string
  tokens: Record<string, string>
  theme: 'light' | 'dark'
}): string {
  const vars = Object.entries(opts.tokens)
    .filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && v && !/[;{}<]/.test(v))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
  const n = opts.nonce ? ` nonce="${attr(opts.nonce)}"` : ''
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${attr(viewCsp(opts.nonce))}">`,
    `<style>:root { color-scheme: ${opts.theme}; ${vars} } html, body { margin: 0; padding: 8px; background: transparent; color: var(--text-primary); font: 13px system-ui, sans-serif; }</style>`,
    `<script${n}>${BRIDGE}</script>`,
    `</head><body data-theme="${opts.theme}">`,
    opts.html,
    opts.script ? `<script${n}>${scriptSafe(opts.script)}</script>` : '',
    '</body></html>'
  ].join('\n')
}

export function bridgeAllowed(method: string, declaredCalls: ReadonlySet<string>): boolean {
  return (VIEW_BRIDGE_METHODS as readonly string[]).includes(method) && declaredCalls.has(`$.${method}`)
}

/** Run one bridged call on the mod's `$`. Throws with a message the view sees. */
export async function runBridgeCall(
  api: ModsApi,
  declaredCalls: ReadonlySet<string>,
  method: string,
  args: unknown
): Promise<unknown> {
  if (!bridgeAllowed(method, declaredCalls)) {
    throw new Error(`${method} is not available to this view (allowed: calls in the bridge list that the mod's source names)`)
  }
  const [ns, fn] = method.split('.')
  const target = (api as unknown as Record<string, Record<string, unknown>>)[ns]?.[fn]
  if (typeof target !== 'function') throw new Error(`${method} is not available`)
  const list = Array.isArray(args) ? args.slice(0, 4) : []
  const value = await (target as (...a: unknown[]) => unknown)(...list)
  // Structured-clone safe and free of functions.
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

let noncePromise: Promise<string> | null = null
export function getViewNonce(): Promise<string> {
  if (!noncePromise) {
    const fn = (globalThis as { window?: { api?: { mods?: { viewNonce?: () => Promise<{ nonce: string }> } } } }).window?.api
      ?.mods?.viewNonce
    noncePromise = fn ? fn().then((r) => String(r?.nonce || '')).catch(() => '') : Promise.resolve('')
  }
  return noncePromise
}

export function __resetViewNonceForTests(): void {
  noncePromise = null
}
