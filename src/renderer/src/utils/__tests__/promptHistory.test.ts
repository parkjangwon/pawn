import { describe, it, expect } from 'vitest'
import {
  collectUserPrompts,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  navigatePromptHistory,
  pushPromptHistory,
  MAX_PROMPT_HISTORY
} from '../promptHistory'

describe('collectUserPrompts', () => {
  it('returns only non-empty user texts oldest-first', () => {
    expect(
      collectUserPrompts([
        { role: 'user', content: ' first ' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
        { role: 'system', content: 'tool' },
        { role: 'user', content: '   ' }
      ])
    ).toEqual(['first', 'second'])
  })

  it('strips display image markdown', () => {
    const content = 'see this\n\n![shot](data:image/png;base64,abc)'
    expect(collectUserPrompts([{ role: 'user', content }])).toEqual(['see this'])
  })
})

describe('caret line helpers', () => {
  it('detects first / last line', () => {
    const v = 'a\nb\nc'
    expect(isCaretOnFirstLine(v, 0)).toBe(true)
    expect(isCaretOnFirstLine(v, 1)).toBe(true)
    expect(isCaretOnFirstLine(v, 2)).toBe(false) // after newline
    expect(isCaretOnLastLine(v, 0)).toBe(false)
    expect(isCaretOnLastLine(v, v.length)).toBe(true)
    expect(isCaretOnLastLine(v, 4)).toBe(true) // on 'c'
  })

  it('treats empty input as both first and last', () => {
    expect(isCaretOnFirstLine('', 0)).toBe(true)
    expect(isCaretOnLastLine('', 0)).toBe(true)
  })
})

describe('navigatePromptHistory', () => {
  const entries = ['one', 'two', 'three']

  it('Up from draft lands on newest and saves draft', () => {
    expect(navigatePromptHistory('up', -1, '', entries, 'drafting')).toEqual({
      index: 2,
      value: 'three',
      draft: 'drafting'
    })
  })

  it('Up walks toward older prompts', () => {
    expect(navigatePromptHistory('up', 2, 'drafting', entries, 'three')).toEqual({
      index: 1,
      value: 'two',
      draft: 'drafting'
    })
    expect(navigatePromptHistory('up', 0, 'drafting', entries, 'one')).toBeNull()
  })

  it('Down restores draft after newest', () => {
    expect(navigatePromptHistory('down', 2, 'drafting', entries, 'three')).toEqual({
      index: -1,
      value: 'drafting',
      draft: 'drafting'
    })
  })

  it('Down walks toward newer prompts', () => {
    expect(navigatePromptHistory('down', 0, 'd', entries, 'one')).toEqual({
      index: 1,
      value: 'two',
      draft: 'd'
    })
  })

  it('returns null with empty history or Down while on draft', () => {
    expect(navigatePromptHistory('up', -1, '', [], '')).toBeNull()
    expect(navigatePromptHistory('down', -1, '', entries, '')).toBeNull()
  })
})

describe('pushPromptHistory', () => {
  it('appends trimmed prompts and caps length', () => {
    const list: string[] = []
    pushPromptHistory(list, '  hi  ')
    expect(list).toEqual(['hi'])
    pushPromptHistory(list, '')
    expect(list).toEqual(['hi'])

    for (let i = 0; i < MAX_PROMPT_HISTORY + 5; i++) pushPromptHistory(list, `p${i}`)
    expect(list.length).toBe(MAX_PROMPT_HISTORY)
    expect(list[0]).toBe(`p${5}`) // oldest of the overflow batch
    expect(list[list.length - 1]).toBe(`p${MAX_PROMPT_HISTORY + 4}`)
  })
})
