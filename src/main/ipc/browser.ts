import { ipcMain, WebContentsView } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import { injectAICursor, cursorShow, cursorHide } from '../browserCursor'
import { injectPicker, stopPicker, getPickerState } from '../browserPicker'

// The embedded browser runs in its own session partition. The app's own CSP is
// installed on `session.defaultSession`; sharing it would apply `default-src
// 'self'` to every website the agent visits and break all of them. A persistent
// partition also gives the agent a durable cookie jar, so a site the user logged
// into stays logged in across runs.
const BROWSER_PARTITION = 'persist:pawn-browser'
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

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

let browserView: WebContentsView | null = null
let browserVisible = false
let pickerActive = false
const browserLogs: string[] = []

function emitBrowserEvent(payload: Record<string, unknown>): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('browser:event', payload)
  }
}

function browserState(): Record<string, unknown> {
  if (!browserView || browserView.webContents.isDestroyed()) return { created: false }
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
  wc.on('did-finish-load', () => {
    injectAICursor(wc)
    // Re-arm the pick overlay after navigation so a mid-session pick stays usable.
    if (pickerActive) injectPicker(wc)
  })
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
    pickerActive = false
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
      pickerActive = false
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

  // Remove the injected AI cursor from the page (turn end / stop). No-op when
  // there is no browser view, so every turn can safely call it.
  handleTrusted('browser:cursorHide', async () => {
    if (browserView && !browserView.webContents.isDestroyed()) {
      cursorHide(browserView.webContents)
    }
    return { ok: true }
  })

  // Element/text pick mode: injects the highlight overlay into the page. While
  // active, clicking an element or dragging text captures it for agent feedback.
  handleTrusted('browser:pickStart', async (_, placeholder: string, hint: string) => {
    const guard = requireView()
    if ('error' in guard) return guard
    pickerActive = true
    injectPicker(guard.view.webContents, String(placeholder || ''), String(hint || ''))
    return { ok: true }
  })

  handleTrusted('browser:pickStop', async () => {
    pickerActive = false
    if (browserView && !browserView.webContents.isDestroyed()) {
      stopPicker(browserView.webContents)
    }
    return { ok: true }
  })

  handleTrusted('browser:pickState', async () => {
    if (!browserView || browserView.webContents.isDestroyed()) {
      return { active: false, selection: null, feedback: '', ready: false }
    }
    const s = await getPickerState(browserView.webContents)
    return {
      active: pickerActive && s.active,
      selection: s.selection,
      feedback: s.feedback,
      ready: s.ready
    }
  })

  handleTrusted('browser:pickClear', async () => {
    if (browserView && !browserView.webContents.isDestroyed()) {
      await browserView.webContents
        .executeJavaScript('window.__pawnPick && window.__pawnPick.clear()', true)
        .catch(() => {})
    }
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
    const wc = view.webContents
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

  handleTrusted('browser:back', async () => {
    const guard = requireView()
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

  handleTrusted('browser:reload', async () => {
    const guard = requireView()
    if ('error' in guard) return guard
    guard.view.webContents.reload()
    return { ok: true }
  })

  handleTrusted('browser:eval', async (_, code: string) => {
    // The async wrapper lets the injected expression await promises; the
    // returned promise is resolved by executeJavaScript itself.
    const source = String(code ?? '')
    let result = await runInPage<unknown>(`(async function(){ try { return { ok: await (${source}) } } catch (e) { return { err: String(e) } } })()`)
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
        })()`)
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
    })()`)
  })

  handleTrusted('browser:readText', async (_, selector: string) => {
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
