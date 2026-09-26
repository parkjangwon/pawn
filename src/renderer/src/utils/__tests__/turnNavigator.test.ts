import { describe, it, expect } from 'vitest'
import {
  appendQuoteToDraft,
  buildTurnItems,
  formatQuote,
  markdownPreviewText,
  turnBarVisual,
  userPreviewText
} from '../turnNavigator'
import type { Message } from '../../stores/app'

const m = (id: string, role: Message['role'], content: string): Message => ({ id, role, content, createdAt: 1 })

describe('buildTurnItems', () => {
  it('creates one item per user prompt paired with the first assistant reply', () => {
    const items = buildTurnItems([
      m('u1', 'user', 'first question'),
      m('t1', 'system', '[Tool: read_file] OK'),
      m('a1', 'assistant', 'first **answer**'),
      m('a1b', 'assistant', 'follow-up text'),
      m('u2', 'user', 'second question')
    ])
    expect(items).toEqual([
      { id: 'u1', index: 0, userPreview: 'first question', replyPreview: 'first answer' },
      { id: 'u2', index: 4, userPreview: 'second question', replyPreview: null }
    ])
  })

  it('skips empty assistant placeholders when picking the reply preview', () => {
    const items = buildTurnItems([m('u1', 'user', 'q'), m('a0', 'assistant', ''), m('a1', 'assistant', 'real')])
    expect(items[0].replyPreview).toBe('real')
  })
})

describe('userPreviewText', () => {
  it('strips injected @file / skill context blocks and inline images', () => {
    const content =
      '<file path="src/a.ts">\nconst secret = 1\n</file>\n\n<skill name="x">\nbody\n</skill>\n\nexplain a.ts ' +
      '![shot](data:image/png;base64,AAAA)'
    expect(userPreviewText(content)).toBe('explain a.ts')
  })

  it('truncates long prompts with an ellipsis', () => {
    const out = userPreviewText('x'.repeat(500), 20)
    expect(out.length).toBe(20)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('markdownPreviewText', () => {
  it('flattens markdown to plain text and elides code fences', () => {
    const md = '# Title\n\n- item **one**\n\n```ts\nconst a = 1\n```\n\nSee [docs](https://x.y).'
    expect(markdownPreviewText(md)).toBe('Title item one ⋯ See docs.')
  })
})

describe('turnBarVisual', () => {
  it('magnifies the focused bar and tapers neighbours', () => {
    expect(turnBarVisual(5, 5).scale).toBeGreaterThan(turnBarVisual(4, 5).scale)
    expect(turnBarVisual(4, 5).scale).toBeGreaterThan(turnBarVisual(3, 5).scale)
    expect(turnBarVisual(3, 5).scale).toBeGreaterThan(turnBarVisual(0, 5).scale)
    expect(turnBarVisual(6, 5)).toEqual(turnBarVisual(4, 5))
  })

  it('is flat when nothing is hovered', () => {
    expect(turnBarVisual(0, null)).toEqual(turnBarVisual(9, null))
  })
})

describe('formatQuote / appendQuoteToDraft', () => {
  it('prefixes every line and keeps blank lines as bare markers', () => {
    expect(formatQuote('line one\n\nline two\r\n')).toBe('> line one\n>\n> line two')
  })

  it('returns an empty string for whitespace-only selections', () => {
    expect(formatQuote('   \n ')).toBe('')
  })

  it('appends to an existing draft with a blank-line separator', () => {
    expect(appendQuoteToDraft('', '> q')).toBe('> q\n\n')
    expect(appendQuoteToDraft('my draft  \n', '> q')).toBe('my draft\n\n> q\n\n')
    expect(appendQuoteToDraft('keep', '')).toBe('keep')
  })
})
