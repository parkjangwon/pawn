import { ipcMain, session, WebContentsView, type WebContents } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { injectAICursor, cursorShow, cursorHide } from '../browserCursor'
import { injectPicker, stopPicker, getPickerState } from '../browserPicker'
import { BrowserTabManager, type BrowserTabInfo } from '../browserTabs'
import { formatRuntimeEvents, parseConsoleMessage, RuntimeEventLog, type RuntimeEventKind, type RuntimeLevel } from '../browserRuntime'
import {
  RECORDER_WORLD_ID,
  buildBrowserRecorderScript,
  buildBrowserRecorderStopScript,
  isRecorderMessage,
  parseRecorderMessage
} from '../recorder/browserScript'
import {
  clickScript,
  fillScript,
  readTextScript,
  resolverExpr,
  scrollScript,
  selectScript,
  snapshotScript,
  waitScript
} from '../browserPageScripts'

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
/** Console / exception / network / crash events per tab (agent runtime perception). */
const runtimeLog = new RuntimeEventLog()
const tabByWebContents = new Map<number, string>()
let networkWatchInstalled = false

/** Failed requests of every tab, attributed through webContentsId. */
function installNetworkWatch(): void {
  if (networkWatchInstalled) return
  networkWatchInstalled = true
  try {
    const ses = session.fromPartition(BROWSER_PARTITION)
    ses.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => {
      if (d.statusCode < 400 || /\/favicon\.ico(\?|$)/.test(d.url)) return
      const tabId = typeof d.webContentsId === 'number' ? tabByWebContents.get(d.webContentsId) : undefined
      if (!tabId) return
      runtimeLog.push(tabId, {
        kind: 'network',
        level: d.statusCode >= 500 ? 'error' : 'warn',
        text: `${d.resourceType || ''}`.trim(),
        url: d.url.slice(0, 500),
        status: d.statusCode,
        method: d.method
      })
    })
    ses.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (d) => {
      if (d.error === 'net::ERR_ABORTED' || d.error === 'net::ERR_BLOCKED_BY_CLIENT') return
      const tabId = typeof d.webContentsId === 'number' ? tabByWebContents.get(d.webContentsId) : undefined
      if (!tabId) return
      runtimeLog.push(tabId, { kind: 'network', level: 'error', text: d.error, url: d.url.slice(0, 500), method: d.method })
    })
  } catch {
    /* partition unavailable (tests) */
  }
}
const views = new Map<string, WebContentsView>()
const logsByTab = new Map<string, string[]>()
let browserVisible = false
let pickerActive = false
/** Last bounds from the UI panel — applied to whichever tab becomes active. */
let lastBounds: { x: number; y: number; width: number; height: number } | null = null

// --- Record & Replay --------------------------------------------------------
// While a recording runs, every user-facing tab carries the isolated-world
// recorder (re-armed after each page load). Subagent tabs are never recorded.
let recording: { nonce: string; onEvent: (raw: unknown) => void } | null = null

function recordableTab(id: string): boolean {
  const owner = tabManager.getById(id)?.owner
  return !owner || !owner.startsWith('subagent:')
}

function armRecorder(wc: WebContents, id: string): void {
  const rec = recording
  if (!rec || wc.isDestroyed() || !recordableTab(id) || !wc.getURL()) return
  void wc
    .executeJavaScriptInIsolatedWorld(RECORDER_WORLD_ID, [{ code: buildBrowserRecorderScript(rec.nonce) }])
    .catch(() => {})
}

function recordNav(id: string, raw: Record<string, unknown>): void {
  const rec = recording
  if (!rec || !recordableTab(id) || tabManager.activeId !== id) return
  rec.onEvent(raw)
}

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
  const wc = getView(id)?.webContents
  if (wc && recording && recordableTab(id) && wc.getURL()) recording.onEvent({ kind: 'tab', url: wc.getURL(), title: wc.getTitle() })
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
  tabByWebContents.set(wc.id, tab.id)
  installNetworkWatch()
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
    runtimeLog.drop(tab.id)
    tabByWebContents.delete(wc.id)
    const result = tabManager.close(tab.id)
    if (result?.nextActiveId) showActiveView()
    if (tabManager.count === 0) pickerActive = false
    emitBrowserEvent({ type: 'tab:closed', tabId: tab.id, ...browserState() })
  })
  // Electron 35+ passes one details object; older versions positional args.
  ;(wc as unknown as { on(ev: string, cb: (...args: unknown[]) => void): void }).on('console-message', (...args: unknown[]) => {
    const m = parseConsoleMessage(args)
    // Recorder lines are a private channel, never page console output.
    if (isRecorderMessage(m.message)) {
      const rec = recording
      const ev = rec && recordableTab(tab.id) ? parseRecorderMessage(m.message, rec.nonce) : null
      if (rec && ev) rec.onEvent({ ...ev, url: wc.getURL(), title: wc.getTitle() })
      return
    }
    const logs = tabLogs(tab.id)
    logs.push(`[${m.level}] ${m.message}${m.source ? ` (${m.source})` : ''}`)
    if (logs.length > 300) logs.splice(0, logs.length - 300)
    if (m.level === 'debug') return
    runtimeLog.push(tab.id, {
      kind: /^Uncaught\b|^Unhandled Promise Rejection/i.test(m.message) ? 'exception' : 'console',
      level: m.level,
      text: m.message,
      ...(m.source ? { source: m.source } : {})
    })
  })
  wc.on('render-process-gone', (_e, details) => {
    runtimeLog.push(tab.id, { kind: 'crash', level: 'error', text: `renderer ${details.reason}${details.exitCode ? ` (exit ${details.exitCode})` : ''}` })
  })
  wc.on('unresponsive', () => {
    runtimeLog.push(tab.id, { kind: 'crash', level: 'warn', text: 'page became unresponsive (main thread blocked)' })
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
    recordNav(tab.id, { kind: 'navigate', url: wc.getURL(), title: wc.getTitle() })
  })
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    emitBrowserEvent({ type: 'navigated', tabId: tab.id, ...browserState() })
    if (isMainFrame !== false) recordNav(tab.id, { kind: 'navigate', url: String(url || wc.getURL()), title: wc.getTitle() })
  })
  wc.on('did-finish-load', () => {
    injectAICursor(wc)
    if (pickerActive && tabManager.activeId === tab.id) injectPicker(wc)
    armRecorder(wc, tab.id)
  })
  wc.on('page-title-updated', () => {
    tabManager.patch(tab.id, { title: wc.getTitle() })
    recordNav(tab.id, { kind: 'title', url: wc.getURL(), title: wc.getTitle() })
    emitBrowserEvent({ type: 'title', tabId: tab.id, ...browserState() })
  })
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 is a user/script-initiated abort
    runtimeLog.push(tab.id, { kind: 'load', level: 'error', text: `${desc} (${code})`, url: String(url || '').slice(0, 500) })
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
    // Clear the timeout when the page wins the race — otherwise every eval
    // leaks a live 30s timer that keeps the loop non-idle.
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([
        exec,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Page script timed out after ${timeoutMs}ms`)), timeoutMs)
        })
      ])
      return result
    } finally {
      if (timer) clearTimeout(timer)
    }
  } catch (err) {
    return { error: 'Page script failed: ' + String(err) }
  }
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
    // Math.max(1, NaN) is NaN — validate before setBounds, which would
    // otherwise deep-throw inside Electron on malformed renderer args.
    for (const n of [x, y, width, height]) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'Invalid bounds' }
    }
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

  handleTrusted('browser:runtime', async (_, owner?: string, opts?: unknown) => {
    // Read-only: never create a tab just to report on it.
    const tab = owner ? tabManager.findByOwner(owner) : tabManager.active
    const res = { tab: tab ?? undefined }
    if (!res.tab) return { ok: false, error: 'No browser tab yet (call browser_navigate first).', events: [], latestSeq: runtimeLog.latestSeq }
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const kinds = Array.isArray(o.kinds)
      ? o.kinds.filter((k): k is RuntimeEventKind => typeof k === 'string' && ['console', 'exception', 'network', 'crash', 'load'].includes(k))
      : undefined
    const minLevel = (['error', 'warn', 'info', 'debug'] as const).find((l) => l === o.minLevel) as RuntimeLevel | undefined
    const events = runtimeLog.events(res.tab.id, {
      since: typeof o.since === 'number' ? o.since : 0,
      kinds,
      minLevel,
      limit: typeof o.limit === 'number' ? o.limit : 100
    })
    if (o.clear === true) runtimeLog.clear(res.tab.id)
    return { ok: true, events, latestSeq: runtimeLog.latestSeq, text: formatRuntimeEvents(events), url: res.tab.url || '' }
  })

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
    return runInPage(snapshotScript(f), owner)
  })

  handleTrusted('browser:click', async (_, ref: string, selector: string, owner?: string) => {
    return runInPage(clickScript(resolverExpr(ref, selector)), owner)
  })

  handleTrusted('browser:fill', async (_, ref: string, selector: string, value: string, submit: boolean, owner?: string) => {
    const v = JSON.stringify(String(value ?? ''))
    const doSubmit = submit === true ? 'true' : 'false'
    return runInPage(fillScript(resolverExpr(ref, selector), v, doSubmit), owner)
  })

  handleTrusted('browser:readText', async (_, selector: string, owner?: string) => {
    const s = JSON.stringify(String(selector || ''))
    return runInPage(readTextScript(s), owner)
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
          waitScript(timeout, selector, text),
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
      return runInPage(scrollScript(dy, dx, JSON.stringify(selector)), owner)
    }
  )

  handleTrusted(
    'browser:select',
    async (_, opts?: { ref?: string; selector?: string; value?: string }, owner?: string) => {
      const ref = opts?.ref ? String(opts.ref) : ''
      const selector = opts?.selector ? String(opts.selector) : ''
      const value = opts?.value != null ? String(opts.value) : ''
      return runInPage(selectScript(ref, selector, value), owner)
    }
  )
}

// --- Record & Replay adapter (used by the recorder service) -----------------

/** Start recording the user's actions in every user-facing tab. */
export function startBrowserRecording(nonce: string, onEvent: (raw: unknown) => void): { ok: boolean; error?: string; notes?: string[] } {
  if (!/^[A-Za-z0-9]{16,}$/.test(nonce)) return { ok: false, error: 'Invalid recorder nonce' }
  recording = { nonce, onEvent }
  const notes: string[] = []
  let armed = 0
  views.forEach((view, id) => {
    const wc = view.webContents
    if (wc.isDestroyed() || !recordableTab(id)) return
    if (wc.getURL()) armed++
    armRecorder(wc, id)
  })
  if (armed === 0) notes.push('The Pawn browser had no page open when recording started.')
  // The page on screen right now is where the demo starts.
  const active = activeView()?.webContents
  if (active && !active.isDestroyed() && active.getURL() && tabManager.activeId && recordableTab(tabManager.activeId)) {
    onEvent({ kind: 'navigate', url: active.getURL(), title: active.getTitle() })
  }
  return { ok: true, notes }
}

export async function stopBrowserRecording(): Promise<void> {
  if (!recording) return
  const code = buildBrowserRecorderStopScript()
  // Stopping flushes text typed a moment ago; keep the channel open until then.
  await Promise.all(
    Array.from(views.values()).map(async (view) => {
      const wc = view.webContents
      if (wc.isDestroyed() || !wc.getURL()) return
      await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(RECORDER_WORLD_ID, [{ code }]).catch(() => {}),
        new Promise((r) => setTimeout(r, 800))
      ])
    })
  )
  recording = null
}

/** JPEG of the visible browser tab (max 1280 px wide), or null. */
export async function captureBrowserFrame(): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const view = activeView()
  const id = tabManager.activeId
  if (!view || !id || view.webContents.isDestroyed() || !view.webContents.getURL() || !recordableTab(id)) return null
  try {
    let img = await view.webContents.capturePage()
    if (img.isEmpty()) return null
    const size = img.getSize()
    if (size.width > 1280) img = img.resize({ width: 1280, quality: 'good' })
    const out = img.getSize()
    return { dataUrl: `data:image/jpeg;base64,${img.toJPEG(62).toString('base64')}`, width: out.width, height: out.height }
  } catch {
    return null
  }
}

