import { describe, it, expect } from 'vitest'
import { formatBrowserSelectionBlock, summarizeBrowserSelection } from '../browserFeedback'

describe('browserFeedback', () => {
  it('formats an element selection with selector, ref and URL', () => {
    const block = formatBrowserSelectionBlock(
      {
        kind: 'element',
        tag: 'button',
        id: 'submit',
        classes: 'btn primary',
        selector: '#submit.btn.primary',
        ref: 'e123',
        text: 'Save changes',
        url: 'https://example.com/edit'
      },
      'Make this button wider'
    )
    expect(block).toContain('<browser_selection url="https://example.com/edit">')
    expect(block).toContain('kind: element')
    expect(block).toContain('tag: button')
    expect(block).toContain('selector: #submit.btn.primary')
    expect(block).toContain('ref: e123')
    expect(block).toContain('Make this button wider')
  })

  it('formats a text selection with selected text', () => {
    const block = formatBrowserSelectionBlock(
      {
        kind: 'text',
        text: 'hello world',
        contextTag: 'h1',
        contextText: 'Hello world',
        url: 'https://example.com'
      },
      ''
    )
    expect(block).toContain('kind: text')
    expect(block).toContain('selected_text: hello world')
    expect(block).toContain('context_tag: h1')
    expect(block).not.toContain('Make this')
  })

  it('summarizes element and text selections for the feedback bar', () => {
    expect(summarizeBrowserSelection({ kind: 'element', selector: 'a.nav > li' })).toBe('a.nav > li')
    expect(summarizeBrowserSelection({ kind: 'element', text: 'Click me', tag: 'button' })).toBe('Click me')
    expect(summarizeBrowserSelection({ kind: 'text', text: 'some long selection text' })).toBe('some long selection text')
  })
})
