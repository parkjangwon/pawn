/**
 * Renderer-side bridge to the embedded browser (an Electron WebContentsView owned
 * by the main process). This is the one object both the agent tools (tools.ts)
 * and the UI panel (BrowserView.tsx) talk to, so the two never fight over
 * navigation state — the main process is the single source of truth and this
 * module just calls its IPC surface.
 *
 * Only available in the Electron build: `window.api.platform !== 'browser'` and
 * the browser IPC methods exist. In dev:web mode there is no native view to
 * drive, so getBrowserAgent() returns null and the tools report that plainly
 * instead of silently no-op'ing against a sandboxed iframe.
 */

export interface BrowserTabInfo {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserAgent {
  ensure: () => Promise<{ error?: string }>
  navigate: (url: string) => Promise<{ url?: string; title?: string; error?: string }>
  snapshot: (filter: string) => Promise<{
    url: string; title: string
    elements: Array<{ ref: string; role: string; text: string; name: string; placeholder: string; value: string; href: string }>
    truncated: boolean
    error?: string
  }>
  click: (ref: string, selector: string) => Promise<{ message: string; error?: string }>
  fill: (ref: string, selector: string, value: string, submit: boolean) => Promise<{ message: string; error?: string }>
  readText: (selector: string) => Promise<{ text: string; error?: string }>
  evaluate: (code: string) => Promise<{ result: string; error?: string }>
  back: () => Promise<{ url?: string; error?: string }>
  screenshot: () => Promise<{ bytes: number; dataUrl?: string; error?: string }>
  wait: (opts?: {
    ms?: number
    selector?: string
    text?: string
    timeoutMs?: number
  }) => Promise<{ ok?: boolean; waitedMs?: number; error?: string }>
  scroll: (opts?: { dy?: number; dx?: number; selector?: string }) => Promise<{
    ok?: boolean
    error?: string
  }>
  select: (opts?: { ref?: string; selector?: string; value?: string }) => Promise<{
    message?: string
    error?: string
  }>
  /** Multi-tab: list tabs + which one is active. */
  tabs: () => Promise<{ tabs: BrowserTabInfo[]; activeTabId: string | null; error?: string }>
  /** Open a new tab (optionally navigated to `url`); it becomes active. */
  tabNew: (url?: string) => Promise<{ tabs: BrowserTabInfo[]; activeTabId: string | null; tabId?: string; error?: string }>
  tabSwitch: (id: string) => Promise<{ ok?: boolean; error?: string }>
  tabClose: (id: string) => Promise<{ ok?: boolean; error?: string }>
}

let cached: BrowserAgent | null | undefined
/** Per-owner agents for parallel browsing (subagent runs keep their own tab). */
const cachedAgents = new Map<string, BrowserAgent>()

/** Drop a bound agent when its owner run ends (frees the per-run closure). */
export function releaseBrowserAgent(owner: string): void {
  cachedAgents.delete(owner)
}

/**
 * Build (and memoize) a BrowserAgent bound to an owner key. Owner-less agents
 * drive the visible tab (UI / legacy); `session:` and `subagent:` agents drive
 * their own tab — see src/main/browserTabs.ts for the ownership model.
 */
export function getBrowserAgent(owner?: string): BrowserAgent | null {
  if (!owner && cached !== undefined) return cached
  if (owner && cachedAgents.has(owner)) return cachedAgents.get(owner)!

  const api = window.api
  const isElectron = !!api && api.platform !== 'browser' && !!api.browser?.ensure
  if (!isElectron) {
    if (!owner) cached = null
    return null
  }

  const build = (): BrowserAgent => ({
    ensure: async () => {
      const res = await api.browser.ensure(owner)
      return res.error ? { error: res.error } : {}
    },
    navigate: async (url) => {
      const res = await api.browser.navigate(url, owner)
      if (res.error) return { error: res.error }
      return { url: res.url, title: res.title }
    },
    snapshot: async (filter) => {
      const res = await api.browser.snapshot(filter, owner)
      if (res.error) return { url: '', title: '', elements: [], truncated: false, error: res.error }
      return {
        url: res.url || '',
        title: res.title || '',
        elements: res.elements || [],
        truncated: res.truncated === true
      }
    },
    click: async (ref, selector) => {
      const res = await api.browser.click(ref, selector, owner)
      return res.error ? { message: '', error: res.error } : { message: res.message || 'Clicked' }
    },
    fill: async (ref, selector, value, submit) => {
      const res = await api.browser.fill(ref, selector, value, submit, owner)
      return res.error ? { message: '', error: res.error } : { message: res.message || 'Filled' }
    },
    readText: async (selector) => {
      const res = await api.browser.readText(selector, owner)
      return res.error ? { text: '', error: res.error } : { text: res.text || '' }
    },
    evaluate: async (code) => {
      const res = await api.browser.eval(code, owner)
      return res.error ? { result: '', error: res.error } : { result: res.result ?? 'undefined' }
    },
    back: async () => {
      const res = await api.browser.back(owner)
      return res.error ? { error: res.error } : { url: res.url }
    },
    screenshot: async () => {
      const res = await api.browser.screenshot(owner)
      if (res.error) return { bytes: 0, error: res.error }
      return { bytes: res.bytes || 0, dataUrl: res.dataUrl }
    },
    wait: async (opts) => {
      const res = await api.browser.wait?.(opts, owner)
      if (!res) return { error: 'browser.wait unavailable' }
      if (res.error || res.ok === false) return { error: res.error || 'wait failed', waitedMs: res.waitedMs }
      return { ok: true, waitedMs: res.waitedMs }
    },
    scroll: async (opts) => {
      const res = await api.browser.scroll?.(opts, owner)
      if (!res) return { error: 'browser.scroll unavailable' }
      return res.error ? { error: res.error } : { ok: true }
    },
    select: async (opts) => {
      const res = await api.browser.select?.(opts, owner)
      if (!res) return { error: 'browser.select unavailable' }
      return res.error
        ? { error: res.error }
        : { message: res.message || 'Selected' }
    },
    tabs: async () => {
      const res = await api.browser.tabs(owner)
      if (res.error) return { tabs: [], activeTabId: null, error: res.error }
      return { tabs: res.tabs || [], activeTabId: res.activeTabId ?? null }
    },
    tabNew: async (url) => {
      const res = await api.browser.tabCreate(url || '', owner)
      if (res.error) return { tabs: [], activeTabId: null, error: res.error }
      return { tabs: res.tabs || [], activeTabId: res.activeTabId ?? null, tabId: res.tabId }
    },
    tabSwitch: async (id) => {
      const res = await api.browser.tabSwitch(id, owner)
      return res.error ? { ok: false, error: res.error } : { ok: true }
    },
    tabClose: async (id) => {
      const res = await api.browser.tabClose(id, owner)
      return res.error ? { ok: false, error: res.error } : { ok: true }
    }
  })

  const agent = build()
  if (!owner) {
    cached = agent
  } else {
    cachedAgents.set(owner, agent)
  }
  return agent
}
