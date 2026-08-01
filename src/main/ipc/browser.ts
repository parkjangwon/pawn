import { ipcMain, WebContentsView } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'

// The embedded browser runs in its own session partition. The app's own CSP is
// installed on `session.defaultSession`; sharing it would apply `default-src
// 'self'` to every website the agent visits and break all of them. A persistent
// partition also gives the agent a durable cookie jar, so a site the user logged
// into stays logged in across runs.
const BROWSER_PARTITION = 'persist:pawn-browser'
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

let browserView: WebContentsView | null = null
let browserVisible = false
const browserLogs: string[] = []

function emitBrowserEvent(payload: Record<string, unknown>): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('browser:event', payload)
  }
}

function browserState(): Record<string, unknown> {
  if (!browserView) return { created: false }
  const wc = browserView.webContents
  const nav = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean } }).navigationHistory
  return {
    created: true,
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: nav ? nav.canGoBack() : false,
    canGoForward: nav ? nav.canGoForward() : false,
    visible: browserVisible
  }
}

function ensureBrowserView(): WebContentsView {
  if (browserView && !browserView.webContents.isDestroyed()) return browserView

  browserView = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  const wc = browserView.webContents
  wc.setUserAgent(BROWSER_USER_AGENT)
  // While the embedded page has focus, keyboard events never reach the main
  // window's renderer, so app shortcuts would silently die. Forward the
  // right-panel toggle (Option+Cmd/Ctrl+B) to the main window instead.
  wc.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.alt &&
      (input.meta || input.control) &&
      input.key.toLowerCase() === 'b'
    ) {
      event.preventDefault()
      getMainWindow()?.webContents.send('app:shortcut', 'toggle-right-panel')
    }
  })
  // Popups navigate the same view instead of spawning windows the agent cannot see.
  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url).catch(() => {})
    return { action: 'deny' }
  })
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = level === 2 ? 'warn' : level === 3 ? 'error' : 'info'
    browserLogs.push(`[${tag}] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`)
    if (browserLogs.length > 300) browserLogs.splice(0, browserLogs.length - 300)
  })
  wc.on('did-start-loading', () => emitBrowserEvent({ type: 'loading', ...browserState() }))
  wc.on('did-stop-loading', () => emitBrowserEvent({ type: 'loaded', ...browserState() }))
  wc.on('did-navigate', () => { browserLogs.length = 0; emitBrowserEvent({ type: 'navigated', ...browserState() }) })
  wc.on('did-navigate-in-page', () => emitBrowserEvent({ type: 'navigated', ...browserState() }))
  wc.on('page-title-updated', () => emitBrowserEvent({ type: 'title', ...browserState() }))
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 is a user/script-initiated abort
    emitBrowserEvent({ type: 'error', code, description: desc, url, ...browserState() })
  })

  const win = getMainWindow()
  if (win) {
    win.contentView.addChildView(browserView)
    // Parked off-screen until the panel positions it, so an agent-created page is
    // live and scriptable without flashing over the UI.
    browserView.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
    browserView.setVisible(false)
    browserVisible = false
  }
  return browserView
}

function requireView(): { view: WebContentsView } | { error: string } {
  if (!browserView || browserView.webContents.isDestroyed()) {
    return { error: 'Browser not created' }
  }
  if (!browserView.webContents.getURL()) {
    return { error: 'No page loaded. Call browser_navigate first.' }
  }
  return { view: browserView }
}

/** Run an expression in the page and normalise the failure into a value. */
async function runInPage<T>(code: string): Promise<T | { error: string }> {
  const guard = requireView()
  if ('error' in guard) return guard
  try {
    return (await guard.view.webContents.executeJavaScript(code, true)) as T
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
  handleTrusted('browser:ensure', async () => {
    try {
      ensureBrowserView()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('browser:create', async () => {
    try {
      ensureBrowserView()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('browser:destroy', async () => {
    try {
      const win = getMainWindow()
      if (browserView && win && !browserView.webContents.isDestroyed()) {
        win.contentView.removeChildView(browserView)
        browserView.webContents.close()
      }
      browserView = null
      browserVisible = false
      browserLogs.length = 0
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('browser:setVisible', async (_, visible: boolean) => {
    if (!browserView || browserView.webContents.isDestroyed()) return { ok: true }
    browserView.setVisible(visible)
    browserVisible = visible
    return { ok: true }
  })

  handleTrusted('browser:bounds', async (_, x: number, y: number, width: number, height: number) => {
    if (!browserView || browserView.webContents.isDestroyed()) return { error: 'Browser not created' }
    browserView.setBounds({
      x: Math.round(x), y: Math.round(y),
      width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height))
    })
    return { ok: true }
  })

  handleTrusted('browser:state', async () => browserState())
  handleTrusted('browser:logs', async () => browserLogs.slice(-50))

  handleTrusted('browser:navigate', async (_, rawUrl: string) => {
    const view = ensureBrowserView()
    let url = String(rawUrl || '').trim()
    if (!url) return { error: 'Empty URL' }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url

    try {
      await view.webContents.loadURL(url)
    } catch (err) {
      const msg = String(err)
      // ERR_ABORTED fires on redirects and on pages that navigate during load;
      // the page is usually fine, so report the resulting URL rather than failing.
      if (!msg.includes('ERR_ABORTED')) return { error: `Failed to load ${url}: ${msg}` }
    }
    return { url: view.webContents.getURL(), title: view.webContents.getTitle() }
  })

  handleTrusted('browser:back', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    const wc = guard.view.webContents
    const nav = (wc as unknown as { navigationHistory?: { canGoBack(): boolean; goBack(): void } }).navigationHistory
    if (!nav || !nav.canGoBack()) return { error: 'No previous page in history' }
    nav.goBack()
    await new Promise((r) => setTimeout(r, 400))
    return { url: wc.getURL() }
  })

  handleTrusted('browser:reload', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    guard.view.webContents.reload()
    return { ok: true }
  })

  handleTrusted('browser:eval', async (_, code: string) => {
    const result = await runInPage<unknown>(`(function(){ try { return { ok: (${code}) } } catch (e) { return { err: String(e) } } })()`)
    if (result && typeof result === 'object' && 'error' in (result as object)) return result
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

  handleTrusted('browser:snapshot', async (_, filter: string) => {
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
    })()`)
  })

  handleTrusted('browser:click', async (_, ref: string, selector: string) => {
    return runInPage(`(function(){
      var el = ${resolverExpr(ref, selector)};
      if (!el) return { error: 'No element matched. Take a fresh browser_snapshot — refs are invalidated by navigation.' };
      try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
      if (el.focus) { try { el.focus() } catch (e) {} }
      var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName).toString().replace(/\\s+/g,' ').trim().slice(0, 60);
      el.click();
      return { message: 'Clicked ' + JSON.stringify(label) + '. Take a new snapshot if the page changed.' };
    })()`)
  })

  handleTrusted('browser:fill', async (_, ref: string, selector: string, value: string, submit: boolean) => {
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
      if (${doSubmit}) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        if (el.form && el.form.requestSubmit) { try { el.form.requestSubmit() } catch (e) {} }
      }
      return { message: 'Filled ' + (el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName) + (${doSubmit} ? ' and submitted' : '') };
    })()`)
  })

  handleTrusted('browser:readText', async (_, selector: string) => {
    const s = JSON.stringify(String(selector || ''))
    return runInPage(`(function(){
      var s = ${s};
      var root = document.body;
      if (s) { try { root = document.querySelector(s) } catch (e) { root = null } }
      if (!root) return { error: 'No element matched selector ' + s };
      var text = (root.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      return { text: text.slice(0, 12000), truncated: text.length > 12000 };
    })()`)
  })

  handleTrusted('browser:screenshot', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    try {
      const image = await guard.view.webContents.capturePage()
      const dataUrl = image.toDataURL()
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
    if (!browserView || browserView.webContents.isDestroyed()) return { error: 'Browser not created' }
    return { url: browserView.webContents.getURL() }
  })
}
