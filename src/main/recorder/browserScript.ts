/**
 * In-page recorder for Pawn's embedded browser (Record & Replay).
 *
 * Injected with executeJavaScriptInIsolatedWorld, so page scripts cannot see
 * or tamper with it (separate JS globals, shared DOM). It listens in the
 * capture phase and reports each action through console.debug with a
 * per-recording random nonce, which the main process filters out of the
 * console log. Only `isTrusted` events count: clicks the agent synthesizes
 * (el.click()) are ignored, so only the user's own demonstration is recorded.
 *
 * Password / one-time-code / card fields never have their value read.
 *
 * Dependency-free (also loaded as plain JS by the Electron smoke test).
 */

export const RECORDER_WORLD_ID = 1071
export const RECORDER_PREFIX = '__pawnrec:'

/** Parse a console line from the recorder; null when it isn't ours. */
export function parseRecorderMessage(message: unknown, nonce: string): Record<string, unknown> | null {
  if (typeof message !== 'string') return null
  const head = `${RECORDER_PREFIX}${nonce}:`
  if (!message.startsWith(head)) return null
  try {
    const o = JSON.parse(message.slice(head.length))
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Any recorder-shaped line (even with a stale or forged nonce): never log it. */
export function isRecorderMessage(message: unknown): boolean {
  return typeof message === 'string' && message.startsWith(RECORDER_PREFIX)
}

export function buildBrowserRecorderScript(nonce: string, opts: { allowUntrusted?: boolean } = {}): string {
  const N = JSON.stringify(String(nonce).replace(/[^A-Za-z0-9]/g, ''))
  const P = JSON.stringify(RECORDER_PREFIX)
  const UNTRUSTED = opts.allowUntrusted ? 'true' : 'false'
  return `(function(){
  var NONCE = ${N};
  var PREFIX = ${P} + NONCE + ':';
  var ALLOW_UNTRUSTED = ${UNTRUSTED};
  if (window.__pawnRec) {
    if (window.__pawnRec.nonce === NONCE) return 'already';
    try { window.__pawnRec.stop(); } catch (e) {}
  }
  var SECRET_RE = /pass(word|wd|code)?|pwd|secret|token|otp|one.?time|\\bpin\\b|cvv|cvc|csc|ssn|card.?(num|no)|security.?code|api.?key/i;
  var ACTIONABLE = 'a,button,input,select,textarea,label,summary,option,[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=treeitem],[role=gridcell],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]';
  var pending = new Map();
  var lastSent = new WeakMap();

  function send(o) {
    try { console.debug(PREFIX + JSON.stringify(o)); } catch (e) {}
  }
  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function textOf(id) {
    var el = id && document.getElementById(id);
    return el ? (el.innerText || el.textContent || '') : '';
  }
  function labelOf(el) {
    if (!el || el.nodeType !== 1) return '';
    var v = el.getAttribute('aria-label');
    if (v) return v;
    var by = el.getAttribute('aria-labelledby');
    if (by) { var t = by.split(/\\s+/).map(textOf).join(' '); if (t.trim()) return t; }
    if (el.labels && el.labels.length) { var l = el.labels[0].innerText || el.labels[0].textContent; if (l && l.trim()) return l; }
    if (el.id) { try { var lf = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (lf) return lf.innerText || lf.textContent || ''; } catch (e) {} }
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var wrap = el.closest('label');
      if (wrap) { var wt = (wrap.innerText || wrap.textContent || '').trim(); if (wt) return wt; }
      if (tag === 'INPUT' && /^(submit|button|reset)$/i.test(el.type)) return el.value || '';
      return el.getAttribute('placeholder') || el.getAttribute('title') || '';
    }
    if (tag === 'IMG') return el.getAttribute('alt') || el.getAttribute('title') || '';
    var txt = el.innerText || el.textContent || '';
    if (txt.trim()) return txt;
    var img = el.querySelector && el.querySelector('img[alt],svg[aria-label]');
    if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || '';
    return el.getAttribute('title') || '';
  }
  function sameClass(a, b) {
    if (!a.classList || !b.classList || a.classList.length !== b.classList.length) return false;
    for (var i = 0; i < a.classList.length; i++) if (!b.classList.contains(a.classList[i])) return false;
    return true;
  }
  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return '';
    try {
      if (el.id && document.getElementById(el.id) === el && !/\\d{3,}/.test(el.id)) return '#' + CSS.escape(el.id);
      var tid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
      if (tid) return '[data-testid="' + tid.replace(/"/g, '') + '"]';
      if (el.name && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return el.tagName.toLowerCase() + '[name="' + String(el.name).replace(/"/g, '') + '"]';
      var parts = [], node = el;
      while (node && node.nodeType === 1 && parts.length < 4) {
        var part = node.tagName.toLowerCase();
        if (node.id && !/\\d{3,}/.test(node.id)) { parts.unshift(part + '#' + CSS.escape(node.id)); break; }
        var cls = Array.prototype.slice.call(node.classList || []).filter(function (c) { return !/\\d{3,}|^(is|has)-|active|hover|focus/.test(c); }).slice(0, 2)
          .map(function (c) { return '.' + CSS.escape(c); }).join('');
        part += cls;
        var parent = node.parentElement;
        if (parent) {
          var sibs = Array.prototype.filter.call(parent.children, function (s) { return s.tagName === node.tagName && sameClass(node, s); });
          if (sibs.length > 1) part += ':nth-of-type(' + (Array.prototype.filter.call(parent.children, function (s) { return s.tagName === node.tagName; }).indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    } catch (e) { return ''; }
  }
  function isSecret(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password') return true;
    var ac = String(el.getAttribute('autocomplete') || '');
    if (/cc-|one-time-code|current-password|new-password/i.test(ac)) return true;
    return SECRET_RE.test([el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' '));
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var d = { tag: el.tagName.toLowerCase() };
    var role = el.getAttribute('role'); if (role) d.role = clip(role, 30);
    var label = clip(labelOf(el), 120); if (label) d.label = label;
    if (el.name) d.name = clip(el.name, 60);
    if (el.id && !/\\d{4,}/.test(el.id)) d.id = clip(el.id, 80);
    var ph = el.getAttribute('placeholder'); if (ph) d.placeholder = clip(ph, 120);
    if (el.tagName === 'INPUT') d.inputType = String(el.type || 'text').toLowerCase();
    if (el.tagName === 'A' && el.href) d.href = String(el.href).slice(0, 500);
    var sel = selectorOf(el); if (sel) d.selector = sel;
    if (d.label && isSecret(el)) d.label = d.label.slice(0, 40);
    return d;
  }
  function actionable(el) {
    if (!el || el.nodeType !== 1) return el;
    var hit = el.closest ? el.closest(ACTIONABLE) : null;
    return hit || el;
  }
  function editable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !/^(checkbox|radio|submit|button|reset|image|file|range|color|hidden)$/i.test(el.type);
    return el.isContentEditable === true;
  }
  function valueOf(el) {
    if (el.isContentEditable) return clip(el.innerText || '', 300);
    return clip(el.value, 300);
  }
  function flush(el) {
    if (!pending.has(el)) return;
    clearTimeout(pending.get(el));
    pending.delete(el);
    if (isSecret(el)) {
      if (lastSent.get(el) === '\\u0000secret') return;
      lastSent.set(el, '\\u0000secret');
      send({ kind: 'input', target: describe(el), secret: true });
      return;
    }
    var v = valueOf(el);
    if (lastSent.get(el) === v) return;
    lastSent.set(el, v);
    send({ kind: 'input', target: describe(el), value: v });
  }
  function flushAll() { Array.from(pending.keys()).forEach(flush); }
  function trusted(e) { return e.isTrusted || ALLOW_UNTRUSTED; }
  function origin(e) { var p = e.composedPath ? e.composedPath() : []; return (p && p[0] && p[0].nodeType === 1) ? p[0] : e.target; }

  var lastSyntheticClick = 0;
  function onClick(e) {
    // A form submitted by a synthetic click still fires a trusted submit; remember it.
    if (!e.isTrusted) lastSyntheticClick = Date.now();
    if (!trusted(e)) return;
    var raw = origin(e);
    var el = actionable(raw);
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'OPTION' || el.tagName === 'SELECT') return;
    // Label clicks are reported by the click the browser forwards to its control.
    if (el.tagName === 'LABEL' && el.control) return;
    flushAll();
    var ev = { kind: 'click', target: describe(el), button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left', clickCount: e.detail || 1 };
    var box = el.type && /^(checkbox|radio)$/i.test(el.type) ? el : null;
    if (box) { setTimeout(function () { ev.checked = !!box.checked; send(ev); }, 0); return; }
    send(ev);
  }
  function onContext(e) {
    if (!trusted(e)) return;
    var el = actionable(origin(e));
    if (el && el.nodeType === 1) { flushAll(); send({ kind: 'click', target: describe(el), button: 'right', clickCount: 1 }); }
  }
  function onInput(e) {
    if (!trusted(e)) return;
    var el = origin(e);
    if (!editable(el)) return;
    var prev = pending.get(el);
    if (prev) clearTimeout(prev);
    pending.set(el, setTimeout(function () { flush(el); }, 900));
  }
  function onChange(e) {
    if (!trusted(e)) return;
    var el = origin(e);
    if (!el || el.nodeType !== 1) return;
    if (editable(el)) { if (!pending.has(el)) pending.set(el, 0); flush(el); return; }
    if (el.tagName === 'SELECT') {
      var opt = el.options && el.options[el.selectedIndex];
      if (isSecret(el)) send({ kind: 'select', target: describe(el), secret: true });
      else send({ kind: 'select', target: describe(el), value: clip(opt ? (opt.text || opt.value) : el.value, 200) });
      return;
    }
    if (el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'file') {
      var names = Array.prototype.map.call(el.files || [], function (f) { return f.name; }).join(', ');
      send({ kind: 'input', target: describe(el), value: clip(names, 300) });
    }
  }
  function onSubmit(e) {
    if (!trusted(e)) return;
    if (!ALLOW_UNTRUSTED && Date.now() - lastSyntheticClick < 100) return;
    flushAll();
    var f = e.target;
    send({ kind: 'submit', target: f && f.nodeType === 1 ? { tag: 'form', label: clip(f.getAttribute('aria-label') || f.getAttribute('name') || f.id || '', 80) } : null });
  }
  function onKey(e) {
    if (!trusted(e) || e.repeat) return;
    var k = e.key;
    var mods = [];
    if (e.metaKey) mods.push('cmd');
    if (e.ctrlKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    var el = origin(e);
    if (mods.length && k && k.length === 1) {
      if (e.shiftKey) mods.push('shift');
      send({ kind: 'key', key: mods.concat([k.toLowerCase()]).join('+') });
      return;
    }
    if (k === 'Enter' || k === 'Escape') {
      if (editable(el)) { if (!pending.has(el)) pending.set(el, 0); flush(el); }
      if (k === 'Enter' && el && el.tagName === 'TEXTAREA' && !mods.length) return;
      send({ kind: 'key', key: k, target: el && el.nodeType === 1 && editable(el) ? describe(el) : undefined });
    }
  }
  var lastScroll = 0;
  function onWheel(e) {
    if (!trusted(e)) return;
    var now = Date.now();
    if (now - lastScroll < 1200) return;
    lastScroll = now;
    send({ kind: 'scroll', direction: e.deltaY < 0 ? 'up' : e.deltaY > 0 ? 'down' : (e.deltaX < 0 ? 'left' : 'right') });
  }
  var opts = { capture: true, passive: true };
  var hooks = [['click', onClick], ['contextmenu', onContext], ['input', onInput], ['change', onChange], ['submit', onSubmit], ['keydown', onKey], ['wheel', onWheel]];
  hooks.forEach(function (h) { window.addEventListener(h[0], h[1], opts); });
  function onHide() { flushAll(); }
  window.addEventListener('pagehide', onHide, true);
  window.__pawnRec = {
    nonce: NONCE,
    stop: function () {
      flushAll();
      hooks.forEach(function (h) { window.removeEventListener(h[0], h[1], opts); });
      window.removeEventListener('pagehide', onHide, true);
      delete window.__pawnRec;
    }
  };
  return 'ok';
})()`
}

export function buildBrowserRecorderStopScript(): string {
  return `(function(){ try { if (window.__pawnRec) window.__pawnRec.stop(); } catch (e) {} return 'stopped' })()`
}
