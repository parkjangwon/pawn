import { describe, it, expect } from 'vitest'
import type { IBuffer, IBufferLine } from '@xterm/xterm'
import { getHttpLinksForTerminalBufferLine, isHttpTerminalUrl } from '../terminalLinks'

interface FakeCell {
  getWidth: () => number
  getChars: () => string
}

function fakeLine(text: string, isWrapped = false): IBufferLine {
  return {
    isWrapped,
    getCell: (x: number): FakeCell | undefined => {
      if (x < 0 || x >= text.length) return undefined
      return { getWidth: () => 1, getChars: () => text[x] ?? '' }
    }
  } as unknown as IBufferLine
}

function fakeBuffer(lines: IBufferLine[]): IBuffer {
  return {
    length: lines.length,
    getLine: (i: number): IBufferLine | undefined => lines[i]
  } as unknown as IBuffer
}

describe('isHttpTerminalUrl', () => {
  it('accepts http(s) only', () => {
    expect(isHttpTerminalUrl('https://example.com')).toBe(true)
    expect(isHttpTerminalUrl('http://x.io/y')).toBe(true)
    expect(isHttpTerminalUrl('ftp://x.io')).toBe(false)
    expect(isHttpTerminalUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('getHttpLinksForTerminalBufferLine', () => {
  it('returns undefined when there is no URL', () => {
    const buffer = fakeBuffer([fakeLine('just some output')])
    expect(getHttpLinksForTerminalBufferLine(buffer, 1, 80)).toBeUndefined()
  })

  it('finds a plain URL with underline + pointer decorations', () => {
    const buffer = fakeBuffer([fakeLine('see https://example.com/docs now')])
    const links = getHttpLinksForTerminalBufferLine(buffer, 1, 80)
    expect(links).toHaveLength(1)
    expect(links?.[0].text).toBe('https://example.com/docs')
    expect(links?.[0].decorations).toEqual({ underline: true, pointerCursor: true })
  })

  it('trims trailing punctuation and unbalanced brackets', () => {
    const buffer = fakeBuffer([fakeLine('(see https://example.com/a).')])
    const links = getHttpLinksForTerminalBufferLine(buffer, 1, 80)
    expect(links?.[0].text).toBe('https://example.com/a')
  })

  it('rejoins wrapped lines before matching', () => {
    const buffer = fakeBuffer([
      fakeLine('open https://example.com/very/long/pa'),
      fakeLine('th/here please', true)
    ])
    const links = getHttpLinksForTerminalBufferLine(buffer, 2, 80)
    expect(links?.[0].text).toBe('https://example.com/very/long/path/here')
  })
})
