import { describe, it, expect } from 'vitest'
import { languageForPath, highlightCode } from '../syntaxHighlight'

describe('languageForPath', () => {
  it('maps common source extensions to registered languages', () => {
    expect(languageForPath('/proj/src/app.ts')).toBe('typescript')
    expect(languageForPath('app.tsx')).toBe('typescript')
    expect(languageForPath('a.js')).toBe('javascript')
    expect(languageForPath('config.json')).toBe('json')
    expect(languageForPath('style.css')).toBe('css')
    expect(languageForPath('page.html')).toBe('xml')
    expect(languageForPath('README.md')).toBe('markdown')
    expect(languageForPath('run.sh')).toBe('bash')
  })

  it('returns null for unknown or unsupported extensions', () => {
    expect(languageForPath('weird.zomg')).toBeNull()
    expect(languageForPath('Makefile')).toBeNull()
  })
})

describe('highlightCode', () => {
  it('wraps recognized tokens in hljs spans for a known language', () => {
    const html = highlightCode('const x = 1;', 'javascript')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('const')
    expect(html).toContain('hljs-number')
  })

  it('falls back to escaped plaintext for an unknown language', () => {
    const html = highlightCode('a < b & c', null)
    expect(html).toBe('a &lt; b &amp; c')
    expect(html).not.toContain('hljs-')
  })

  it('escapes HTML in plaintext fallback so markup never leaks through', () => {
    expect(highlightCode('<script>', 'totally-not-a-language')).toBe('&lt;script&gt;')
  })
})
