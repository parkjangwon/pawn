import type { WebContents } from 'electron'

/**
 * Injected AI cursor for the embedded browser. The overlay lives inside the
 * page DOM so it survives nothing, but it is cheap to re-inject after every
 * navigation. All styling is applied through CSSOM and the Web Animations API
 * rather than a <style> tag, so strict page CSPs cannot strip it.
 */

const CURSOR_INJECT_JS = `(function(){
  if (document.getElementById('pawn-ai-cursor')) return
  var root = document.createElement('div')
  root.id = 'pawn-ai-cursor'
  root.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;will-change:transform;transition-property:transform;transition-timing-function:cubic-bezier(.33,.12,.28,.98);transition-duration:0ms'
  // A classic mouse-pointer arrow; the tip is the hotspot.
  var NS = 'http://www.w3.org/2000/svg'
  var svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '26')
  svg.setAttribute('height', '26')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.style.cssText = 'display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))'
  var path = document.createElementNS(NS, 'path')
  path.setAttribute('d', 'M4.037 4.688a.495.495 0 01.651-.651l16 6.5a.5.5 0 01-.063.947l-6.124 1.58a2 2 0 00-1.438 1.435l-1.579 6.126a.5.5 0 01-.947.063l-6.5-16z')
  path.setAttribute('fill', '#ff8a3d')
  path.setAttribute('stroke', '#ffffff')
  path.setAttribute('stroke-width', '1.4')
  svg.appendChild(path)
  root.appendChild(svg)
  var label = document.createElement('span')
  label.textContent = 'AI'
  label.style.cssText = 'position:absolute;left:15px;top:-7px;background:#ff8a3d;color:#fff;font:600 9px/1.5 -apple-system,Segoe UI,sans-serif;padding:1px 5px;border-radius:8px;letter-spacing:0;box-shadow:0 1px 2px rgba(0,0,0,.25)'
  root.appendChild(label)
  var spin = document.createElement('div')
  spin.style.cssText = 'position:absolute;left:27px;top:7px;width:11px;height:11px;border-radius:50%;border:2px solid rgba(255,138,61,.9);border-top-color:transparent;display:none'
  root.appendChild(spin)
  document.body.appendChild(root)

  var modeTimer = null
  var lastX = -1000, lastY = -1000
  function clearAnimations() {
    svg.getAnimations().forEach(function (a) { a.cancel() })
    spin.getAnimations().forEach(function (a) { a.cancel() })
  }
  function hide() {
    if (modeTimer) { clearTimeout(modeTimer); modeTimer = null }
    clearAnimations()
    root.style.display = 'none'
  }
  function show(x, y, mode, holdMs) {
    if (modeTimer) { clearTimeout(modeTimer); modeTimer = null }
    clearAnimations()
    spin.style.display = 'none'
    var wasHidden = root.style.display === 'none'
    var dx = x - lastX, dy = y - lastY
    var dist = Math.sqrt(dx * dx + dy * dy)
    // Distance-based glide: short hops stay snappy, long journeys slow down.
    var dur = wasHidden ? 0 : Math.min(750, Math.max(260, Math.round(dist * 0.7)))
    lastX = x
    lastY = y
    root.style.display = 'block'
    root.style.transitionDuration = dur + 'ms'
    // Tip of the arrow lands on the target (arrow tip sits at ~(4.5, 5) in the
    // 26px box, scaled from the 24px viewBox).
    root.style.transform = 'translate(' + (x - 4.5) + 'px,' + (y - 5) + 'px)'
    // First appearance pops in; later moves glide via the CSS transition.
    if (wasHidden) {
      svg.animate([{ transform: 'scale(0.75)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 150, easing: 'ease-out' })
    }
    var applyMode = function () {
      if (mode === 'click') {
        svg.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.82)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' })
      } else if (mode === 'type') {
        svg.animate([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 500, iterations: Infinity })
      } else if (mode === 'loading') {
        svg.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(0deg)' }], { duration: 600, iterations: Infinity })
        spin.style.display = 'block'
        spin.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 900, iterations: Infinity })
      }
    }
    if (mode !== 'loading' && dur > 0) {
      modeTimer = setTimeout(applyMode, dur)
    } else {
      applyMode()
    }
    return dur
  }

  window.__pawnCursor = { show: show, hide: hide }
  // Rest on the page once injected so the AI pointer is always visible, like a
  // hovering cursor waiting for its next instruction.
  show(window.innerWidth / 2, window.innerHeight / 2, 'move')
})()`

export function injectAICursor(wc: WebContents): void {
  if (wc.isDestroyed()) return
  wc.executeJavaScript(CURSOR_INJECT_JS, true).catch(() => {})
}

export function cursorShow(
  wc: WebContents,
  x: number,
  y: number,
  mode: 'move' | 'click' | 'type' | 'loading' | 'arrive',
  holdMs?: number
): void {
  if (wc.isDestroyed()) return
  wc.executeJavaScript(
    `window.__pawnCursor && window.__pawnCursor.show(${Math.round(x)}, ${Math.round(y)}, ${JSON.stringify(mode)}, ${holdMs ?? 'null'})`,
    true
  ).catch(() => {})
}

export function cursorHide(wc: WebContents): void {
  if (wc.isDestroyed()) return
  wc.executeJavaScript('window.__pawnCursor && window.__pawnCursor.hide()', true).catch(() => {})
}
