/**
 * Page scripts injected into the embedded browser, as pure builders. Each
 * returns the exact script text the IPC handlers in ipc/browser.ts used to
 * inline; they now call these so the scripts are unit-testable without
 * Electron. String args arrive pre-JSON-stringified where the script
 * interpolates them raw (filterJson, valueJson, …).
 */

/** Resolve an element from a snapshot ref or a CSS selector. */
export function resolverExpr(ref: string, selector: string): string {
  const r = JSON.stringify(ref || '')
  const s = JSON.stringify(selector || '')
  return `(function(){ var r=${r}, s=${s};
    if (r) { var byRef = document.querySelector('[data-pawn-ref="' + r.replace(/"/g,'') + '"]'); if (byRef) return byRef }
    if (s) { try { return document.querySelector(s) } catch (e) { return null } }
    return null })()`
}

/** Interactive-element snapshot with deterministic data-pawn-ref hashing. */
export function snapshotScript(filterJson: string): string {
  return `(function(){
      var FILTER = ${filterJson};
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
    })()`
}

/** Click a resolved element, gliding the fake cursor first when present. */
export function clickScript(resolver: string): string {
  return `(function(){
      var el = ${resolver};
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
    })()`
}

/** Fill a resolved element (framework-safe) and optionally submit. */
export function fillScript(resolver: string, valueJson: string, submitJs: string): string {
  return `(function(){
      var el = ${resolver};
      if (!el) return { error: 'No element matched. Take a fresh browser_snapshot — refs are invalidated by navigation.' };
      var value = ${valueJson};
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
        if (${submitJs}) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          if (el.form && el.form.requestSubmit) { try { el.form.requestSubmit() } catch (e) {} }
        }
        return { message: 'Filled ' + (el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName) + (${submitJs} ? ' and submitted' : '') };
      };
      if (window.__pawnCursor) {
        return new Promise(function (resolve) {
          var move = window.__pawnCursor.show(cx, cy, 'type') || 0;
          setTimeout(function () { resolve(done()) }, Math.min(900, move + 140 + value.length * 5));
        });
      }
      return done();
    })()`
}

/** Read the innerText of a selector (or body), cursor theatrics included. */
export function readTextScript(selectorJson: string): string {
  return `(function(){
      var s = ${selectorJson};
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
    })()`
}

/** Wait until a selector appears and/or a text is present in body.innerText. */
export function waitScript(timeout: number, selector: string, text: string): string {
  return `(async function(){
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
          })()`
}

/** Scroll the window or a selector by (dx, dy). */
export function scrollScript(dy: number, dx: number, selectorJson: string): string {
  return `(function(){
        var dy = ${dy}, dx = ${dx};
        var s = ${selectorJson};
        var el = s ? null : window;
        if (s) { try { el = document.querySelector(s) } catch (e) { el = null } }
        if (s && !el) return { error: 'No element matched selector' };
        if (el === window) window.scrollBy(dx, dy);
        else el.scrollBy(dx, dy);
        return { ok: true, dx: dx, dy: dy };
      })()`
}

/** Set the value of a <select> and fire input/change. */
export function selectScript(ref: string, selector: string, value: string): string {
  return `(function(){
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
      })()`
}
