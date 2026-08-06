import type { WebContents } from 'electron'

/**
 * Injected "pick" mode for the embedded browser. While active, hovering
 * highlights elements and clicking (or selecting text) captures the target.
 * A speech bubble appears right where the user clicked; typing in it and
 * pressing Enter submits structured feedback back to the renderer, which
 * forwards it to the main chat. Shift+Enter inserts a newline.
 *
 * The bubble lives INSIDE the page DOM (like the AI cursor overlay) because the
 * browser is a native WebContentsView layered above the renderer — a React
 * popover could never appear on top of it. Styling is applied via CSSOM so
 * strict page CSPs cannot strip it.
 */

export function buildPickerJs(placeholder: string, hint: string): string {
  const PH = JSON.stringify(placeholder || 'Feedback…')
  const HINT = JSON.stringify(hint || '↵ Enter to send · ⇧↵ newline · Esc cancel')
  return `(function(){
  if (document.getElementById('pawn-pick-root')) return
  var PLACEHOLDER = ${PH}
  var root = document.createElement('div')
  root.id = 'pawn-pick-root'
  root.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483646;pointer-events:none'
  var hover = document.createElement('div')
  hover.id = 'pawn-pick-hover'
  hover.style.cssText = 'position:absolute;display:none;border:1.5px dashed #ff8a3d;background:rgba(255,138,61,.10);pointer-events:none;box-sizing:border-box;z-index:1'
  var sel = document.createElement('div')
  sel.id = 'pawn-pick-selected'
  sel.style.cssText = 'position:absolute;display:none;border:2px solid #e11d48;background:rgba(225,29,72,.08);pointer-events:none;box-sizing:border-box;z-index:2'
  var bubble = document.createElement('div')
  bubble.id = 'pawn-pick-bubble'
  bubble.style.cssText = 'position:absolute;display:none;z-index:4;pointer-events:auto;background:#ffffff;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:8px;box-sizing:border-box'
  var caret = document.createElement('div')
  caret.style.cssText = 'position:absolute;top:-5px;left:18px;width:10px;height:10px;background:#ffffff;border-left:1px solid #d1d5db;border-top:1px solid #d1d5db;transform:rotate(45deg)'
  var ta = document.createElement('textarea')
  ta.id = 'pawn-pick-input'
  ta.placeholder = PLACEHOLDER
  ta.style.cssText = 'display:block;width:100%;box-sizing:border-box;border:none;outline:none;resize:none;background:transparent;color:#111827;font:13px/1.5 -apple-system,Segoe UI,sans-serif;padding:0;min-height:44px;max-height:140px'
  var hint = document.createElement('div')
  hint.textContent = ${HINT}
  hint.style.cssText = 'display:block;margin-top:5px;font:10px/1.4 -apple-system,Segoe UI,sans-serif;color:#9ca3af'
  bubble.appendChild(caret); bubble.appendChild(ta); bubble.appendChild(hint)
  root.appendChild(hover); root.appendChild(sel); root.appendChild(bubble)
  ;(document.documentElement || document.body).appendChild(root)

  var state = { active: true, selection: null, feedback: '', ready: false }
  var textJustCaptured = false

  function elRect(el) {
    if (!el || el.nodeType !== 1) return { x: 0, y: 0, w: 0, h: 0 }
    var r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  function place(box, r) {
    if (!r || r.w <= 0 || r.h <= 0) { box.style.display = 'none'; return }
    box.style.left = r.x + 'px'; box.style.top = r.y + 'px'
    box.style.width = r.w + 'px'; box.style.height = r.h + 'px'
    box.style.display = 'block'
  }
  function sameClass(a, b) {
    if (!a.classList || !b.classList) return false
    if (a.classList.length !== b.classList.length) return false
    for (var i = 0; i < a.classList.length; i++) if (!b.classList.contains(a.classList[i])) return false
    return true
  }
  function cssSelector(el) {
    if (!el || el.nodeType !== 1) return ''
    if (el.id && document.getElementById(el.id) === el) return '#' + CSS.escape(el.id)
    var parts = [], node = el
    while (node && node.nodeType === 1 && parts.length < 5) {
      var part = node.tagName.toLowerCase()
      if (node.id) {
        part += '#' + CSS.escape(node.id)
      } else {
        var cls = Array.prototype.slice.call(node.classList || []).slice(0, 3)
          .map(function (c) { return '.' + CSS.escape(c) }).join('')
        if (cls) part += cls
      }
      var parent = node.parentElement
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (s) {
          return s.tagName === node.tagName && (node.id || !node.classList.length || sameClass(node, s))
        })
        if (sibs.length > 1) {
          part += ':nth-of-type(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')'
        }
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(' > ')
  }
  function elText(el) {
    if (!el) return ''
    var t = el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || ''
    return String(t).replace(/\\s+/g, ' ').trim().slice(0, 160)
  }
  function elementInfo(el) {
    var refEl = el.getAttribute && el.getAttribute('data-pawn-ref')
      ? el
      : (el.closest && el.closest('[data-pawn-ref]'))
    return {
      kind: 'element',
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      id: el.id || '',
      classes: el.classList ? Array.prototype.slice.call(el.classList).slice(0, 10).join(' ') : '',
      selector: cssSelector(el),
      ref: refEl ? refEl.getAttribute('data-pawn-ref') : null,
      text: elText(el),
      href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      url: location.href,
      box: elRect(el)
    }
  }

  function resizeTa() {
    ta.style.height = 'auto'
    ta.style.height = Math.min(140, Math.max(44, ta.scrollHeight)) + 'px'
  }
  function submitBubble() {
    state.feedback = ta.value
    state.ready = true
    bubble.style.display = 'none'
  }
  function openBubble(r, selInfo) {
    state.selection = selInfo
    state.feedback = ''
    state.ready = false
    var bw = Math.min(300, Math.max(220, Math.round((r.w || 240) * 0.9)))
    bubble.style.width = bw + 'px'
    var x = Math.max(4, Math.min(r.x, window.innerWidth - bw - 4))
    var top = r.y + r.h + 8
    if (top + 150 > window.innerHeight - 4) top = Math.max(4, r.y - 150)
    bubble.style.left = x + 'px'
    bubble.style.top = top + 'px'
    bubble.style.display = 'block'
    ta.value = ''
    resizeTa()
    ta.focus()
  }

  function clear() {
    state.selection = null
    state.feedback = ''
    state.ready = false
    sel.style.display = 'none'
    bubble.style.display = 'none'
  }

  function onMove(e) {
    if (!state.active) return
    var el = e.target
    if (!el || el.nodeType !== 1) return
    if (el.closest && el.closest('#pawn-pick-root')) return
    place(hover, elRect(el))
  }

  function onPick(e) {
    if (!state.active) return
    var el = e.target
    if (el && el.closest && el.closest('#pawn-pick-bubble')) return
    // A text drag ends with a mouseup (which captured the selection) followed
    // by a click — don't let the click overwrite the text selection.
    if (textJustCaptured) {
      textJustCaptured = false
      return
    }
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    if (!el || el.nodeType !== 1) return
    var info = elementInfo(el)
    place(sel, info.box)
    place(hover, null)
    openBubble(info.box, info)
  }

  function onText(e) {
    if (!state.active) return
    var t = e.target
    if (t && t.closest && t.closest('#pawn-pick-bubble')) return
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return
    var s = window.getSelection()
    var text = s ? s.toString().replace(/\\s+/g, ' ').trim() : ''
    if (text.length < 2) { textJustCaptured = false; return }
    var node = (s && s.anchorNode) || null
    var el = (node && node.nodeType === 1 ? node : (node && node.parentElement) || document.body) || document.body
    var info = elementInfo(el)
    var r = info.box
    place(sel, r)
    place(hover, null)
    textJustCaptured = true
    openBubble(r, {
      kind: 'text',
      text: text.slice(0, 4000),
      contextTag: info.tag,
      contextText: info.text.slice(0, 120),
      url: location.href,
      box: r
    })
  }

  ta.addEventListener('input', function () { state.feedback = ta.value; resizeTa() })
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation()
      submitBubble()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      bubble.style.display = 'none'
      state.ready = false
    }
  })

  function onKey(e) {
    if (!state.active) return
    if (e.target && e.target.closest && e.target.closest('#pawn-pick-bubble')) return
    if (e.key === 'Escape') clear()
  }

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onPick, true)
  document.addEventListener('mouseup', onText, true)
  document.addEventListener('keydown', onKey, true)

  window.__pawnPick = {
    getState: function () {
      return { active: state.active, selection: state.selection, feedback: state.feedback, ready: state.ready }
    },
    clear: clear,
    stop: function () {
      state.active = false
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onPick, true)
      document.removeEventListener('mouseup', onText, true)
      document.removeEventListener('keydown', onKey, true)
      root.style.display = 'none'
      if (root.parentNode) root.parentNode.removeChild(root)
    }
  }
})()`
}

export function injectPicker(wc: WebContents, placeholder?: string, hint?: string): void {
  if (wc.isDestroyed()) return
  wc.executeJavaScript(buildPickerJs(placeholder || '', hint || ''), true).catch(() => {})
}

export function stopPicker(wc: WebContents): void {
  if (wc.isDestroyed()) return
  wc.executeJavaScript('window.__pawnPick && window.__pawnPick.stop()', true).catch(() => {})
}

export async function getPickerState(
  wc: WebContents
): Promise<{ active: boolean; selection: unknown; feedback: string; ready: boolean }> {
  if (wc.isDestroyed()) return { active: false, selection: null, feedback: '', ready: false }
  try {
    const s = (await wc.executeJavaScript(
      'window.__pawnPick ? window.__pawnPick.getState() : { active: false, selection: null, feedback: "", ready: false }',
      true
    )) as { active: boolean; selection: unknown; feedback?: string; ready?: boolean }
    return {
      active: s.active === true,
      selection: s.selection ?? null,
      feedback: s.feedback || '',
      ready: s.ready === true
    }
  } catch {
    return { active: false, selection: null, feedback: '', ready: false }
  }
}
