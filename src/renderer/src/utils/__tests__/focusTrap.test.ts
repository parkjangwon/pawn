// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { activateOnKey, getFocusable, isFocusableVisible } from '../focusTrap'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

function fakeRects(n = 1): DOMRectList {
  const rect = { width: 10, height: 10, top: 0, left: 0, bottom: 10, right: 10, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const list = Array.from({ length: n }, () => rect)
  return {
    length: list.length,
    item: (i: number) => list[i] ?? null,
    [Symbol.iterator]: function* () { yield* list },
    ...Object.fromEntries(list.map((r, i) => [i, r]))
  } as unknown as DOMRectList
}

describe('getFocusable', () => {
  let root: HTMLDivElement

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    root.remove()
  })

  it('collects buttons and inputs, skips disabled and tabindex=-1', () => {
    root.innerHTML = `
      <button id="a">A</button>
      <button id="b" disabled>B</button>
      <input id="c" />
      <a href="#" id="d">D</a>
      <div tabindex="0" id="e">E</div>
      <div tabindex="-1" id="f">F</div>
      <span>no</span>
    `
    // jsdom often has empty client rects — stub layout so visibility passes.
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      Object.defineProperty(el, 'offsetParent', { get: () => root, configurable: true })
      vi.spyOn(el, 'getClientRects').mockReturnValue(fakeRects())
    }
    const ids = getFocusable(root).map((el) => el.id)
    expect(ids).toEqual(['a', 'c', 'd', 'e'])
  })

  it('treats fixed-position controls as visible (offsetParent is null)', () => {
    const btn = document.createElement('button')
    btn.id = 'fixed-btn'
    btn.textContent = 'OK'
    btn.style.position = 'fixed'
    root.appendChild(btn)
    Object.defineProperty(btn, 'offsetParent', { get: () => null, configurable: true })
    vi.spyOn(btn, 'getClientRects').mockReturnValue(fakeRects())
    expect(isFocusableVisible(btn)).toBe(true)
    expect(getFocusable(root).map((el) => el.id)).toContain('fixed-btn')
  })

  it('skips hidden / aria-hidden subtrees', () => {
    root.innerHTML = `
      <div hidden><button id="h">H</button></div>
      <div aria-hidden="true"><button id="a">A</button></div>
      <button id="ok">OK</button>
    `
    for (const el of root.querySelectorAll<HTMLElement>('button')) {
      Object.defineProperty(el, 'offsetParent', { get: () => root, configurable: true })
      vi.spyOn(el, 'getClientRects').mockReturnValue(fakeRects())
    }
    expect(getFocusable(root).map((el) => el.id)).toEqual(['ok'])
  })
})

describe('activateOnKey', () => {
  it('runs action on Enter/Space on the row itself', () => {
    const action = vi.fn()
    const row = document.createElement('div')
    const ev = {
      key: 'Enter',
      target: row,
      currentTarget: row,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as ReactKeyboardEvent
    activateOnKey(ev, action)
    expect(action).toHaveBeenCalledOnce()
    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('ignores keys from nested buttons', () => {
    const action = vi.fn()
    const row = document.createElement('div')
    const nested = document.createElement('button')
    row.appendChild(nested)
    const ev = {
      key: ' ',
      target: nested,
      currentTarget: row,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as ReactKeyboardEvent
    activateOnKey(ev, action)
    expect(action).not.toHaveBeenCalled()
  })
})
