// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FIND_HIGHLIGHT,
  FIND_HIGHLIGHT_ACTIVE,
  REVEAL_EVENT,
  clearFindHighlights,
  collectFindRanges,
  initialFindIndex,
  paintFindHighlights,
  revealAndScrollToRange,
  stepFindIndex
} from '../conversationFind'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'chat-messages'
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('collectFindRanges', () => {
  it('finds case-insensitive matches in user and assistant bodies, in order', () => {
    const root = mount(`
      <div class="message user"><div class="message-content">Fix the Bug</div></div>
      <div class="message assistant"><div class="message-content"><p>bug one, <b>BUG</b> two</p></div></div>
    `)
    const ranges = collectFindRanges(root, 'bug')
    expect(ranges.map((r) => r.toString())).toEqual(['Bug', 'bug', 'BUG'])
  })

  it('ignores tool rows, role labels, buttons, and find-ignored chrome', () => {
    const root = mount(`
      <div class="message system"><div class="message-content">bug in tool output</div></div>
      <div class="message assistant">
        <div class="message-role">bug</div>
        <div class="message-content">
          <div data-find-ignore="true">bug header</div>
          <button>bug</button>
          <p>real bug</p>
        </div>
      </div>
    `)
    expect(collectFindRanges(root, 'bug')).toHaveLength(1)
  })

  it('finds repeated matches within one text node without overlap', () => {
    const root = mount('<div class="message user"><div class="message-content">aaaa</div></div>')
    expect(collectFindRanges(root, 'aa')).toHaveLength(2)
  })

  it('returns nothing for an empty query or missing root', () => {
    const root = mount('<div class="message user"><div class="message-content">text</div></div>')
    expect(collectFindRanges(root, '   ')).toEqual([])
    expect(collectFindRanges(null, 'text')).toEqual([])
  })
})

describe('stepFindIndex', () => {
  it('wraps around in both directions', () => {
    expect(stepFindIndex(2, 3, 'next')).toBe(0)
    expect(stepFindIndex(0, 3, 'prev')).toBe(2)
    expect(stepFindIndex(1, 3, 'next')).toBe(2)
  })

  it('starts from the ends when there is no current match', () => {
    expect(stepFindIndex(-1, 4, 'next')).toBe(0)
    expect(stepFindIndex(-1, 4, 'prev')).toBe(3)
    expect(stepFindIndex(0, 0, 'next')).toBe(-1)
  })
})

describe('initialFindIndex', () => {
  it('falls back to the last match when geometry is unavailable', () => {
    const root = mount('<div class="message user"><div class="message-content">x x x</div></div>')
    const ranges = collectFindRanges(root, 'x')
    // jsdom has no layout; ranges have no rect → prefer the latest match.
    expect(initialFindIndex(ranges, 0)).toBe(2)
    expect(initialFindIndex([], 0)).toBe(-1)
  })
})

describe('paintFindHighlights (CSS Custom Highlight API)', () => {
  const registry = new Map<string, unknown>()

  beforeEach(() => {
    registry.clear()
    class FakeHighlight {
      ranges: Range[]
      priority = 0
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    ;(globalThis as any).CSS = { highlights: registry, escape: (s: string) => s }
    ;(window as any).Highlight = FakeHighlight
  })

  afterEach(() => {
    delete (window as any).Highlight
    delete (globalThis as any).CSS
  })

  it('registers all matches and the active match with a higher priority', () => {
    const root = mount('<div class="message user"><div class="message-content">a b a</div></div>')
    const ranges = collectFindRanges(root, 'a')
    paintFindHighlights(ranges, 1)
    const all = registry.get(FIND_HIGHLIGHT) as { ranges: Range[]; priority: number }
    const active = registry.get(FIND_HIGHLIGHT_ACTIVE) as { ranges: Range[]; priority: number }
    expect(all.ranges).toHaveLength(2)
    expect(active.ranges).toEqual([ranges[1]])
    expect(active.priority).toBeGreaterThan(all.priority)
  })

  it('clears both highlights', () => {
    paintFindHighlights([], -1)
    clearFindHighlights()
    expect(registry.size).toBe(0)
  })
})

describe('revealAndScrollToRange', () => {
  it('asks a folded container to reveal itself before scrolling', () => {
    const root = mount(`
      <div class="message assistant"><div class="message-content">
        <div class="code-block-wrapper" data-folded="true"><pre>needle</pre></div>
      </div></div>
    `)
    const folded = root.querySelector('[data-folded]')!
    const onReveal = vi.fn()
    folded.addEventListener(REVEAL_EVENT, onReveal)
    const [range] = collectFindRanges(root, 'needle')
    revealAndScrollToRange(range, 'auto')
    expect(onReveal).toHaveBeenCalledTimes(1)
  })
})
