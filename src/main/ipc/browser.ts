import { ipcMain, WebContentsView } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { injectAICursor, cursorShow, cursorHide } from '../browserCursor'
import { injectPicker, stopPicker, getPickerState } from '../browserPicker'
import { BrowserTabManager, type BrowserTabInfo } from '../browserTabs'

// The embedded browser runs in its own session partition. The app's own CSP is
// installed on `session.defaultSession`; sharing it would apply `default-src
// 'self'` to every website the agent visits and break all of them. A persistent
// partition also gives the agent a durable cookie jar, so a site the user logged
// into stays logged in across runs.
const BROWSER_PARTITION = 'persist:pawn-browser'
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** Hard cap on simultaneous tabs: each one owns a renderer process. */
const MAX_TABS = 8

/** Where inactive tabs are parked: off-screen, hidden, still alive. */
const PARK_BOUNDS = { x: -10000, y: -10000, width: 1280, height: 800 }

/**
 * Normalize a navigation target and enforce an http/https allowlist. Allowing
 * file:/javascript:/data: here would let the agent read local files through
 * browser_snapshot/readText without ever touching the permission system.
 */
function normalizeBrowserUrl(rawUrl: string): string | null {
  let url = String(rawUrl || '').trim()
  if (!url) return null
  if (!SCHEME_RE.test(url)) url = 'https://' + url
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

// --- Multi-view state -------------------------------------------------------
// `tabManager` is pure bookkeeping (ids, order, active tab). `views` maps each
// tab id to its WebContentsView; only the active tab's view is visible and
// positioned, the rest are parked off-screen and stay alive (background
// throttling keeps hidden pages cheap).

const tabManager = new BrowserTabManager()
const views = new Map<string, WebContentsView>()
const logsByTab = new Map<string, string[]>()
let browserVisible = false
let pickerActive = false
/** Last bounds from the UI panel — applied to whichever tab becomes active. */
let lastBounds: { x: number; y: number; width: number; height: number } | null = null

// Parallel browsing: every tab is bound to an owner key (see BrowserTabInfo).
// Owner-less calls (UI panel / legacy) drive the visible tab; `session:` owners
// drive their own tab and make it visible; `subagent:` owners drive a parked
// tab so concurrent subagents never fight over (or yank) the visible one.

function getView(id: string | null | undefined): WebContentsView | null {
  if (!id) return null
  const view = views.get(id)
  if (!view || view.webContents.isDestroyed()) return null
  return view
}

function activeView(): WebContentsView | null {
  return getView(tabManager.activeId)
}

function tabLogs(id: string | null | undefined): string[] {
  if (!id) return []
  let logs = logsByTab.get(id)
  if (!logs) {
    logs = []
    logsByTab.set(id, logs)
  }
  return logs
}

function emitBrowserEvent(payload: Record<string, unknown>): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('browser:event', payload)
  }
}

function browserState(): Record<string, unknown> {
  const active = tabManager.active
  const wc = getView(tabManager.activeId)?.webContents ?? null
  if (!active || !wc) {
    return {
      created: tabManager.count > 0,
      activeTabId: tabManager.activeId,
      tabs: tabManager.list,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      visible: browserVisible
    }
  }
  const nav = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean } }).navigationHistory
  return {
    created: true,
    activeTabId: active.id,
    tabs: tabManager.list,
    url: active.url || wc.getURL(),
    title: active.title || wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: nav ? nav.canGoBack() : false,
    canGoForward: nav ? nav.canGoForward() : false,
    visible: browserVisible
  }
}

function parkView(view: WebContentsView): void {
  if (view.webContents.isDestroyed()) return
  view.setBounds({ ...PARK_BOUNDS })
  view.setVisible(false)
}

function showActiveView(): void {
  const view = activeView()
  if (!view || view.webContents.isDestroyed()) return
  if (lastBounds) view.setBounds(lastBounds)
  view.setVisible(browserVisible)
  const wc = view.webContents
  // Overlays live inside the page DOM and die on navigation; re-arm them for
  // the tab that just became visible.
  injectAICursor(wc)
  if (pickerActive) injectPicker(wc)
}

/** Make `id` the active tab: park the others, show it, re-arm overlays. */
function activateTab(id: string): boolean {
  if (!tabManager.has(id)) return false
  tabManager.switch(id)
  views.forEach((view, tid) => {
    if (tid === id) showActiveView()
    else parkView(view)
  })
  emitBrowserEvent({ type: 'tab:activated', tabId: id, ...browserState() })
  return true
}

function createTabView(initialUrl?: string, owner?: string | null): { tab?: BrowserTabInfo; error?: string } {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return { error: 'No main window' }
  if (tabManager.count >= MAX_TABS) {
    return { error: `Too many browser tabs open (max ${MAX_TABS}). Close one with browser_tab_close first.` }
  }

  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  const wc = view.webContents
  wc.setUserAgent(BROWSER_USER_AGENT)

  const prevActive = tabManager.activeId
  const tab = tabManager.create({ owner })
  views.set(tab.id, view)
  logsByTab.set(tab.id, [])
  win.contentView.addChildView(view)
  parkView(view)

  // Popups (target=_blank) become a new tab instead of overwriting the page the
  // agent is working on — the new tab becomes active like a real browser and
  // inherits the opener's owner so a subagent's popups stay in its sandbox.
  wc.setWindowOpenHandler(({ url }) => {
    const safe = normalizeBrowserUrl(url)
    if (safe && tabManager.count < MAX_TABS) createTabView(safe, tab.owner)
    return { action: 'deny' }
  })
  // External teardown (main window closed/recreated) must not leave ghost tabs
  // behind — drop the tab and activate its neighbor when the contents die.
  wc.on('destroyed', () => {
    if (!views.has(tab.id)) return
    views.delete(tab.id)
    logsByTab.delete(tab.id)
    const result = tabManager.close(tab.id)
    if (result?.nextActiveId) showActiveView()
    if (tabManager.count === 0) pickerActive = false
    emitBrowserEvent({ type: 'tab:closed', tabId: tab.id, ...browserState() })
  })
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = level === 2 ? 'warn' : level === 3 ? 'error' : 'info'
    const logs = tabLogs(tab.id)
    logs.push(`[${tag}] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`)
    if (logs.length > 300) logs.splice(0, logs.length - 300)
  })
  wc.on('did-start-loading', () => {
    tabManager.patch(tab.id, { loading: true })
    emitBrowserEvent({ type: 'loading', tabId: tab.id, ...browserState() })
  })
  wc.on('did-stop-loading', () => {
    tabManager.patch(tab.id, { loading: false })
    emitBrowserEvent({ type: 'loaded', tabId: tab.id, ...browserState() })
  })
  wc.on('did-navigate', () => {
    tabLogs(tab.id).length = 0
    tabManager.patch(tab.id, { url: wc.getURL(), title: wc.getTitle() })
    emitBrowserEvent({ type: 'navigated', tabId: tab.id, ...browserState() })
  })
  wc.on('did-navigate-in-page', () => emitBrowserEvent({ type: 'navigated', tabId: tab.id, ...browserState() }))
  wc.on('did-finish-load', () => {
    injectAICursor(wc)
    if (pickerActive && tabManager.activeId === tab.id) injectPicker(wc)
  })
  wc.on('page-title-updated', () => {
    tabManager.patch(tab.id, { title: wc.getTitle() })
    emitBrowserEvent({ type: 'title', tabId: tab.id, ...browserState() })
  })
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 is a user/script-initiated abort
    emitBrowserEvent({ type: 'error', tabId: tab.id, code, description: desc, url, ...browserState() })
  })

  if (initialUrl) {
    const safe = normalizeBrowserUrl(initialUrl)
    if (safe) void wc.loadURL(safe).catch(() => {})
  }
  // Visibility: `session:`-owner and owner-less (UI) tabs drive the visible
  // view (the panel keeps showing what the parent agent / user does).
  // `subagent:` tabs always stay parked so concurrent runs never yank the UI —
  // even when they happen to be the very first tab ever created.
  if (!owner || owner.startsWith('session:')) {
    activateTab(tab.id)
  } else {
    // A parked subagent tab must never hijack the manager's active-tab
    // bookkeeping: activeView()/browserState() keep pointing at the visible
    // tab (and the screenshot parked-guard keys off this too). With no prior
    // visible tab, unset the active so ownerless calls report "no browser"
    // instead of resolving to the parked view.
    tabManager.switch(prevActive)
    emitBrowserEvent({ type: 'tab:created', tabId: tab.id, ...browserState() })
  }
  return { tab: { ...tab } }
}

function closeTab(id: string): { error?: string } {
  const result = tabManager.close(id)
  if (!result) return { error: 'No such tab' }
  const view = views.get(id)
  if (view) {
    const win = getMainWindow()
    if (win && !win.isDestroyed() && !view.webContents.isDestroyed()) {
      win.contentView.removeChildView(view)
      view.webContents.close()
    }
    views.delete(id)
  }
  logsByTab.delete(id)
  if (result.nextActiveId) {
    showActiveView()
  } else {
    // Last tab closed — nothing left to drive.
    pickerActive = false
  }
  emitBrowserEvent({ type: 'tab:closed', tabId: id, ...browserState() })
  return {}
}

function destroyAll(): void {
  const win = getMainWindow()
  views.forEach((view, id) => {
    if (win && !win.isDestroyed() && !view.webContents.isDestroyed()) {
      win.contentView.removeChildView(view)
      view.webContents.close()
    }
    logsByTab.delete(id)
  })
  views.clear()
  tabManager.clear()
  browserVisible = false
  pickerActive = false
}

/** Make sure at least one tab exists (the agent/UI may create the browser lazily). */
function ensureTabs(): { error?: string } {
  if (tabManager.count === 0) {
    const res = createTabView()
    if (res.error) return { error: res.error }
  }
  return {}
}

/**
 * Resolve the tab a browser tool should act on.
 * - owner undefined → the visible tab (UI panel / legacy calls)
 * - owner given     → that owner's tab, creating one on first use so the owner
 *                     reuses the same tab across calls and turns (efficiency)
 * `session:` owners make their tab visible (the panel shows what the parent
 * agent does); `subagent:` owners act on a parked tab so concurrent runs never
 * fight over (or yank) the visible one.
 */
function resolveTab(owner?: string): { view?: WebContentsView; tab?: BrowserTabInfo; error?: string } {
  if (!owner) {
    const view = activeView()
    if (!view) return { error: 'Browser not created. Call browser_navigate first.' }
    return { view, tab: tabManager.active ?? undefined }
  }
  let tab = tabManager.findByOwner(owner)
  if (!tab) {
    const created = createTabView(undefined, owner)
    if (created.error || !created.tab) return { error: created.error || 'Failed to create a tab' }
    tab = created.tab
  }
  const view = getView(tab.id)
  if (!view) return { error: 'Tab is gone (browser window closed?).' }
  if (owner.startsWith('session:') && tabManager.activeId !== tab.id) {
    activateTab(tab.id)
  }
  return { view, tab }
}

function requireView(owner?: string): { view: WebContentsView } | { error: string } {
  const res = resolveTab(owner)
  if (!res.view) return { error: res.error || 'Browser not created. Call browser_navigate first.' }
  if (!res.view.webContents.getURL()) {
    return { error: 'No page loaded. Call browser_navigate first.' }
  }
  return { view: res.view }
}

const EVAL_TIMEOUT_MS = 30_000
const EVAL_MAX_CHARS = 100_000

/** Run an expression in the target page (owner-routed) and normalise the failure into a value. */
async function runInPage<T>(code: string, owner?: string, timeoutMs = EVAL_TIMEOUT_MS): Promise<T | { error: string }> {
  const guard = requireView(owner)
  if ('error' in guard) return guard
  if (typeof code !== 'string') return { error: 'Invalid script' }
  if (code.length > EVAL_MAX_CHARS) {
    return { error: `browser_eval code too large (${code.length} chars, max ${EVAL_MAX_CHARS})` }
  }
  try {
    const exec = guard.view.webContents.executeJavaScript(code, true) as Promise<T>
    const result = await Promise.race([
      exec,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Page script timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
    return result
  } catch (err) {
    return { error: 'Page script failed: ' + String(err) }
  }
}

/** JS that resolves an element from a snapshot ref or a CSS selector. */
function resolverExpr(ref: string, selector: string): string {
  const r = JSON.stringify(ref || '')
  const s = JSON.stringify(selector || '')
  return `(function(){ var r=${r}, s=${s};
    if (r) { var byRef = document.querySelector('[data-pawn-ref="' + r.replace(/"/g,'') + '"]'); if (byRef) return byRef }
    if (s) { try { return document.querySelector(s) } catch (e) { return null } }
    return null })()`
}

export function registerBrowserIpc(): void {
  // Legacy claim/release: superseded by per-owner tabs (each caller drives its
  // own tab, so cross-session conflicts cannot happen). Kept as no-ops so
  // existing renderer call sites keep working.
  handleTrusted('browser:claim', async () => ({ ok: true, ...browserState() }))

  handleTrusted('browser:release', async () => ({ ok: true, ...browserState() }))

  /** Free every tab bound to an owner key (subagent finished / was aborted). */
  handleTrusted('browser:releaseOwner', async (_, owner: string) => {
    if (!owner) return { ok: false, error: 'Missing owner key' }
    // Only subagent runs may bulk-release tabs; session/UI tabs are persistent.
    if (!owner.startsWith('subagent:')) return { ok: false, error: 'Invalid owner key' }
    for (const tab of [...tabManager.list]) {
      if (tab.owner === owner) closeTab(tab.id)
    }
    return { ok: true, ...browserState() }
  })

  handleTrusted('browser:ensure', async (_, owner?: string) => {
    try {
      // Owner-bound callers (agent / subagent) get their own tab created here,
      // so a run never leaves a stray owner-less tab behind after ensure().
      if (typeof owner === 'string' && owner) {
        const res = resolveTab(owner)
        if (res.error) return { error: res.error }
        return { ok: true, ...browserState() }
      }
      const res = ensureTabs()
      if (res.error) return res
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Legacy single-view create — keeps old callers working (same as ensure).
  handleTrusted('browser:create', async () => {
    try {
      const res = ensureTabs()
      if (res.error) return res
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('browser:destroy', async () => {
    try {
      destroyAll()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('browser:setVisible', async (_, visible: boolean) => {
    const view = activeView()
    if (!view) return { ok: true }
    view.setVisible(visible)
    browserVisible = visible
    return { ok: true }
  })

  // Remove the injected AI cursor from the active page (turn end / stop).
  handleTrusted('browser:cursorHide', async () => {
    const view = activeView()
    if (view) cursorHide(view.webContents)
    return { ok: true }
  })

  // Element/text pick mode: injects the highlight overlay into the active page.
  handleTrusted('browser:pickStart', async (_, placeholder: string, hint: string) => {
    const guard = requireView()
    if ('error' in guard) return guard
    pickerActive = true
    injectPicker(guard.view.webContents, String(placeholder || ''), String(hint || ''))
    return { ok: true }
  })

  handleTrusted('browser:pickStop', async () => {
    pickerActive = false
    const view = activeView()
    if (view) stopPicker(view.webContents)
    return { ok: true }
  })

  handleTrusted('browser:pickState', async () => {
    const view = activeView()
    if (!view) return { active: false, selection: null, feedback: '', ready: false }
    const s = await getPickerState(view.webContents)
    return {
      active: pickerActive && s.active,
      selection: s.selection,
      feedback: s.feedback,
      ready: s.ready
    }
  })

  handleTrusted('browser:pickClear', async () => {
    const view = activeView()
    if (view) {
      await view.webContents
        .executeJavaScript('window.__pawnPick && window.__pawnPick.clear()', true)
        .catch(() => {})
    }
    return { ok: true }
  })

  handleTrusted('browser:bounds', async (_, x: number, y: number, width: number, height: number) => {
    const view = activeView()
    if (!view) return { error: 'Browser not created' }
    const bounds = {
      x: Math.round(x), y: Math.round(y),
      width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height))
    }
    lastBounds = bounds
    view.setBounds(bounds)
    return { ok: true }
  })

  handleTrusted('browser:state', async () => browserState())

  /** Owner-scoped tab list: owner-bound callers only see their own + UI tabs. */
  handleTrusted('browser:tabs', async (_, owner?: string) => {
    const list =
      typeof owner === 'string' && owner
        ? tabManager.list.filter((t) => !t.owner || t.owner === owner)
        : tabManager.list
    return { tabs: list, activeTabId: tabManager.activeId }
  })

  handleTrusted('browser:logs', async () => tabLogs(tabManager.activeId).slice(-50))

  handleTrusted('browser:tabCreate', async (_, rawUrl?: string, owner?: string) => {
    try {
      // Efficiency: a subagent run reuses its single tab (parallel browsing is
      // one parked tab per run); session/UI callers always open a fresh tab.
      const own = typeof owner === 'string' && owner ? owner : undefined
      if (own?.startsWith('subagent:')) {
        const existing = tabManager.findByOwner(own)
        if (existing) {
          const view = getView(existing.id)
          if (view && typeof rawUrl === 'string' && rawUrl) {
            const safe = normalizeBrowserUrl(rawUrl)
            if (safe) void view.webContents.loadURL(safe).catch(() => {})
          }
          return { ok: true, reused: true, tabId: existing.id, ...browserState() }
        }
      }
      const created = createTabView(
        typeof rawUrl === 'string' ? rawUrl : undefined,
        own
      )
      if (created.error) return { error: created.error }
      return { ok: true, tabId: created.tab?.id, ...browserState() }
    } catch (err) {
      return { error: String(err) }
    }
  })

  /** Owner-bound callers may only switch to their own tab (ownerless UI tabs are off-limits too). */
  handleTrusted('browser:tabSwitch', async (_, id: string, owner?: string) => {
    if (!id) return { error: 'Missing tab id' }
    const tab = tabManager.getById(id)
    if (!tab) return { error: 'No such tab' }
    if (typeof owner === 'string' && owner && tab.owner !== owner) {
      return { error: 'Cannot switch to another run/session tab' }
    }
    // Subagent tabs are already the target of the run's tools; switching is a
    // no-op that keeps the tab parked so it never yanks the visible view.
    if (owner?.startsWith('subagent:')) {
      return { ok: true, ...browserState() }
    }
    if (!activateTab(id)) return { error: 'No such tab' }
    return { ok: true, ...browserState() }
  })

  handleTrusted('browser:tabClose', async (_, id: string, owner?: string) => {
    if (!id) return { error: 'Missing tab id' }
    const tab = tabManager.getById(id)
    if (!tab) return { error: 'No such tab' }
    if (typeof owner === 'string' && owner && tab.owner !== owner) {
      return { error: 'Cannot close another run/session tab' }
    }
    const err = closeTab(id)
    if (err.error) return err
    return { ok: true, ...browserState() }
  })

  handleTrusted('browser:navigate', async (_, rawUrl: string, owner?: string) => {
    const res = resolveTab(owner)
    if (res.error || !res.view) return { error: res.error || 'Browser not created' }
    const wc = res.view.webContents
    const url = normalizeBrowserUrl(rawUrl)
    if (!url) return { error: 'Only http:// and https:// URLs can be opened in the browser' }
    cursorShow(wc, 140, 24, 'loading')

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      wc.stop()
    }, 60_000)
    try {
      await wc.loadURL(url)
    } catch (err) {
      const msg = String(err)
      if (timedOut) {
        cursorShow(wc, 140, 24, 'move')
        return { error: `Timed out loading ${url}` }
      }
      // ERR_ABORTED fires on redirects and on pages that navigate during load;
      // the page is usually fine, so report the resulting URL rather than failing.
      if (!msg.includes('ERR_ABORTED')) {
        cursorShow(wc, 140, 24, 'move')
        return { error: `Failed to load ${url}: ${msg}` }
      }
    } finally {
      clearTimeout(timer)
    }
    injectAICursor(wc)
    return { url: wc.getURL(), title: wc.getTitle() }
  })

  handleTrusted('browser:back', async (_, owner?: string) => {
    const guard = requireView(owner)
    if ('error' in guard) return guard
    const wc = guard.view.webContents
    const nav = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; goBack(): void } }).navigationHistory
    if (!nav || !nav.canGoBack()) return { error: 'No previous page in history' }
    const before = wc.getURL()
    nav.goBack()
    // Return as soon as the URL actually changes instead of a fixed delay.
    const start = Date.now()
    while (!wc.isDestroyed() && wc.getURL() === before && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    injectAICursor(wc)
    return { url: wc.getURL() }
  })

  handleTrusted('browser:reload', async (_, owner?: string) => {
    const guard = requireView(owner)
    if ('error' in guard) return guard
    guard.view.webContents.reload()
    return { ok: true }
  })

  handleTrusted('browser:eval', async (_, code: string, owner?: string) => {
    // The async wrapper lets the injected expression await promises; the
    // returned promise is resolved by executeJavaScript itself.
    const source = String(code ?? '')
    let result = await runInPage<unknown>(`(async function(){ try { return { ok: await (${source}) } } catch (e) { return { err: String(e) } } })()`, owner)
    if (result && typeof result === 'object' && 'error' in (result as object)) {
      // The whole wrapper failed to parse/run — almost always a syntax error in
      // the agent's expression. Re-parse with new Function (outside the broken
      // wrapper) to surface the real error instead of Chromium's generic
      // "Script failed to execute" message, which the model cannot act on.
      const failure = (result as { error: string }).error || ''
      if (failure.includes('Script failed to execute')) {
        const diag = await runInPage<unknown>(`(async function(){
          try { new Function(${JSON.stringify(source)}); return { syntax: null } }
          catch (e) { return { syntax: String(e) } }
        })()`, owner)
        if (diag && typeof diag === 'object' && !('error' in (diag as object))) {
          const d = diag as { syntax: string | null }
          if (d && d.syntax) {
            return { error: 'Syntax error in browser_eval code: ' + d.syntax }
          }
        }
      }
      return result
    }
    const wrapped = result as { ok?: unknown; err?: string }
    if (wrapped?.err) return { error: wrapped.err }
    let serialized: string
    try {
      serialized = JSON.stringify(wrapped?.ok ?? null, null, 2) ?? 'undefined'
    } catch {
      serialized = String(wrapped?.ok)
    }
    return { result: serialized.slice(0, 8000) }
  })

  handleTrusted('browser:snapshot', async (_, filter: string, owner?: string) => {
    const f = JSON.stringify(String(filter || '').toLowerCase())
    return runInPage(`(function(){
      var FILTER = ${f};
      var SEL = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],[contenteditable=""],[contenteditable="true"]';
      var nodes = Array.prototype.slice.call(document.querySelectorAll(SEL));
      var out = [], used = {};
     for (var i = 0; i < nodes.length; i++) {
       var el = nodes[i];
       var rect = el.getBoundingClientRect();
       if (rect.width === 0 && rect.height === 0) continue;
       var st = window.getComputedStyle(el);
       if (st.visibility === 'hidden' || st.display === 'none') continue;
       if (el.disabled === true) continue;
        // Deterministic ref: hash the element's stable attributes so the same
        // element gets the same ref across snapshots. Sequential numbering (e1,
        // e2, …) invalidated every ref when a single element was inserted or
        // removed, which broke cache prefixes in the transcript.
        var sigParts = [
          el.tagName.toLowerCase(),
          el.getAttribute('role') || '',
          el.getAttribute('name') || '',
          el.getAttribute('id') || '',
          el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
          (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
        ].join('|');
        var hash = 0;
        for (var j = 0; j < sigParts.length; j++) {
          hash = ((hash << 5) - hash + sigParts.charCodeAt(j)) | 0;
        }
        var base = 'e' + Math.abs(hash);
        var ref = base;
        var suf = 1;
        while (used[ref]) { ref = base + '_' + suf; suf++; }
        used[ref] = true;
       el.setAttribute('data-pawn-ref', ref);
        var label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!label && el.labels && el.labels[0]) label = el.labels[0].innerText || '';
        var text = (el.innerText || label || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
        var isSecret = el.tagName === 'INPUT' && (el.type === 'password' || el.autocomplete === 'one-time-code');
        var item = {
          ref: ref,
          role: (el.getAttribute('role') || (el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''))),
          text: text,
          name: (el.getAttribute('name') || el.id || '').slice(0, 60),
          placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
          value: isSecret ? '' : String(el.value == null ? '' : el.value).slice(0, 60),
          href: el.tagName === 'A' ? String(el.getAttribute('href') || '').slice(0, 140) : ''
        };
        if (FILTER) {
          var hay = (item.text + ' ' + item.name + ' ' + item.placeholder + ' ' + item.href).toLowerCase();
          if (hay.indexOf(FILTER) === -1) continue;
        }
        out.push(item);
      }
      return { url: location.href, title: document.title, elements: out.slice(0, 150), truncated: out.length > 150 };
    })()`, owner)
  })

  handleTrusted('browser:click', async (_, ref: string, selector: string, owner?: string) => {
    return runInPage(`(function(){
      var el = ${resolverExpr(ref, selector)};
      if (!el) return { error: 'No element matched. Take a fresh browser_snapshot — refs are invalidated by navigation.' };
      try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
      if (el.focus) { try { el.focus() } catch (e) {} }
      var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName).toString().replace(/\\s+/g,' ').trim().slice(0, 60);
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return new Promise(function (resolve) {
        var doClick = function () {
          el.click();
          resolve({ message: 'Clicked ' + JSON.stringify(label) + '. Take a new snapshot if the page changed.' });
        };
        if (window.__pawnCursor) {
          // Wait for the glide to finish before pressing the target.
          var move = window.__pawnCursor.show(cx, cy, 'click') || 0;
          setTimeout(doClick, move + 90);
        } else {
          doClick();
        }
      });
    })()`, owner)
  })

  handleTrusted('browser:fill', async (_, ref: string, selector: string, value: string, submit: boolean, owner?: string) => {
    const v = JSON.stringify(String(value ?? ''))
    const doSubmit = submit === true ? 'true' : 'false'
    return runInPage(`(function(){
      var el = ${resolverExpr(ref, selector)};
      if (!el) return { error: 'No element matched. Take a fresh browser_snapshot — refs are invalidated by navigation.' };
      var value = ${v};
      try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
      if (el.focus) { try { el.focus() } catch (e) {} }
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if ('value' in el) {
        // Assign through the prototype setter so React and other frameworks that
        // patch the value property still observe the change.
        var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        return { error: 'Element is not editable' };
      }
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var done = function () {
        if (${doSubmit}) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          if (el.form && el.form.requestSubmit) { try { el.form.requestSubmit() } catch (e) {} }
        }
        return { message: 'Filled ' + (el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName) + (${doSubmit} ? ' and submitted' : '') };
      };
      if (window.__pawnCursor) {
        return new Promise(function (resolve) {
          var move = window.__pawnCursor.show(cx, cy, 'type') || 0;
          setTimeout(function () { resolve(done()) }, Math.min(900, move + 140 + value.length * 5));
        });
      }
      return done();
    })()`, owner)
  })

  handleTrusted('browser:readText', async (_, selector: string, owner?: string) => {
    const s = JSON.stringify(String(selector || ''))
    return runInPage(`(function(){
      var s = ${s};
      var root = document.body;
      if (s) { try { root = document.querySelector(s) } catch (e) { root = null } }
      if (!root) return { error: 'No element matched selector ' + s };
      var r = root.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var text = (root.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      if (window.__pawnCursor) {
        window.__pawnCursor.show(cx, cy, 'move');
      }
      return { text: text.slice(0, 12000), truncated: text.length > 12000 };
    })()`, owner)
  })

  handleTrusted('browser:screenshot', async (_, owner?: string) => {
    const res = resolveTab(owner)
    if (res.error || !res.view) return { error: res.error || 'Browser not created' }
    try {
      const image = await res.view.webContents.capturePage()
      const dataUrl = image.toDataURL()
      const parked = owner ? res.tab?.id !== tabManager.activeId : false
      // A parked (subagent) tab is not painted, so capturePage returns a blank
      // frame — tell the caller to use the DOM snapshot instead of a black image.
      if (parked && dataUrl.length < 2_000) {
        return { error: 'Screenshot of a background tab is unavailable (the page is not visible). Use browser_snapshot for its content.' }
      }
      return { dataUrl, bytes: dataUrl.length }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('browser:devtools', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    guard.view.webContents.openDevTools({ mode: 'detach' })
    return { ok: true }
  })

  handleTrusted('browser:getURL', async () => {
    const view = activeView()
    if (!view) return { error: 'Browser not created' }
    return { url: view.webContents.getURL() }
  })

  /** Wait fixed ms and/or until selector/text appears (timeout default 15s). */
  handleTrusted(
    'browser:wait',
    async (
      _,
      opts?: { ms?: number; selector?: string; text?: string; timeoutMs?: number },
      owner?: string
    ) => {
      const guard = requireView(owner)
      if ('error' in guard) return guard
      const timeout = Math.min(60_000, Math.max(100, Math.floor(Number(opts?.timeoutMs) || 15_000)))
      const fixedMs = opts?.ms != null ? Math.min(30_000, Math.max(0, Math.floor(Number(opts.ms)))) : 0
      const selector = opts?.selector ? String(opts.selector) : ''
      const text = opts?.text ? String(opts.text) : ''
      if (fixedMs > 0 && !selector && !text) {
        await new Promise((r) => setTimeout(r, fixedMs))
        return { ok: true, waitedMs: fixedMs }
      }
      try {
        const res = await guard.view.webContents.executeJavaScript(
          `(async function(){
            const timeout = ${timeout};
            const selector = ${JSON.stringify(selector)};
            const text = ${JSON.stringify(text)};
            const start = Date.now();
            function ready() {
              if (selector) {
                try { if (!document.querySelector(selector)) return false } catch (e) { return false }
              }
              if (text) {
                const body = (document.body && document.body.innerText) || '';
                if (!body.includes(text)) return false;
              }
              return true;
            }
            if (ready()) return { ok: true, waitedMs: 0 };
            while (Date.now() - start < timeout) {
              await new Promise(r => setTimeout(r, 120));
              if (ready()) return { ok: true, waitedMs: Date.now() - start };
            }
            return { ok: false, error: 'wait timed out after ' + timeout + 'ms', waitedMs: Date.now() - start };
          })()`,
          true
        )
        return res
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
  )

  handleTrusted(
    'browser:scroll',
    async (_, opts?: { dy?: number; dx?: number; selector?: string }, owner?: string) => {
      const dy = Math.floor(Number(opts?.dy) || 0)
      const dx = Math.floor(Number(opts?.dx) || 0)
      const selector = opts?.selector ? String(opts.selector) : ''
      return runInPage(`(function(){
        var dy = ${dy}, dx = ${dx};
        var s = ${JSON.stringify(selector)};
        var el = s ? null : window;
        if (s) { try { el = document.querySelector(s) } catch (e) { el = null } }
        if (s && !el) return { error: 'No element matched selector' };
        if (el === window) window.scrollBy(dx, dy);
        else el.scrollBy(dx, dy);
        return { ok: true, dx: dx, dy: dy };
      })()`, owner)
    }
  )

  handleTrusted(
    'browser:select',
    async (_, opts?: { ref?: string; selector?: string; value?: string }, owner?: string) => {
      const ref = opts?.ref ? String(opts.ref) : ''
      const selector = opts?.selector ? String(opts.selector) : ''
      const value = opts?.value != null ? String(opts.value) : ''
      return runInPage(`(function(){
        var ref = ${JSON.stringify(ref)};
        var selector = ${JSON.stringify(selector)};
        var value = ${JSON.stringify(value)};
        var el = null;
        if (ref && window.__pawnRefs && window.__pawnRefs[ref]) el = window.__pawnRefs[ref];
        if (!el && selector) { try { el = document.querySelector(selector) } catch (e) {} }
        if (!el) return { error: 'Element not found' };
        if (el.tagName !== 'SELECT') return { error: 'Element is not a <select>' };
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: el.value, message: 'Selected ' + JSON.stringify(el.value) };
      })()`, owner)
    }
  )
}
