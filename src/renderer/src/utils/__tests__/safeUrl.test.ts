import { describe, it, expect } from 'vitest'
import { isInlineImageSrc } from '../safeUrl'

describe('isInlineImageSrc', () => {
  it('allows only data:image and blob: sources', () => {
    expect(isInlineImageSrc('data:image/png;base64,AAAA')).toBe(true)
    expect(isInlineImageSrc('blob:https://app/1234')).toBe(true)
    expect(isInlineImageSrc('https://evil.example/p.png?q=secret')).toBe(false)
    expect(isInlineImageSrc('http://127.0.0.1/x.png')).toBe(false)
    expect(isInlineImageSrc('file:///etc/passwd')).toBe(false)
    expect(isInlineImageSrc('data:text/html;base64,AAAA')).toBe(false)
  })
})
