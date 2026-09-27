import { describe, it, expect } from 'vitest'

import { tokenize, stem } from '../tokenize'
import { chunkFile, languageForPath } from '../chunker'

describe('tokenize', () => {
  it('splits camelCase / PascalCase / acronym+digits', () => {
    const toks = tokenize('parseHTTPResponse2')
    expect(toks).toContain('parse')
    expect(toks).toContain('http')
    expect(toks).toContain('response')
  })

  it('splits snake_case and kebab-case (with is a dropped stopword)', () => {
    expect(tokenize('fetch_with_retry')).toEqual(expect.arrayContaining(['fetch', 'retry']))
    expect(tokenize('my-cool-thing')).toEqual(expect.arrayContaining(['my', 'cool', 'thing']))
  })

  it('drops 1-char tokens and stopwords', () => {
    const toks = tokenize('the a function foo')
    expect(toks).not.toContain('the')
    expect(toks).not.toContain('function')
    expect(toks).toContain('foo')
  })

  it('applies light stemming', () => {
    expect(stem('retries')).toBe('retry')
    expect(stem('running')).toBe('runn')
    expect(stem('requests')).toBe('request')
  })
})

describe('chunkFile', () => {
  it('detects TS function/class/type boundaries with symbols', () => {
    const src = [
      '// header comment',
      'export function alpha() {',
      '  return 1',
      '}',
      '',
      'export class Beta {',
      '  method() {}',
      '}',
      '',
      'export type Gamma = { x: number }'
    ].join('\n')
    const chunks = chunkFile('src/a.ts', src)
    const syms = chunks.map((c) => c.symbol).filter(Boolean)
    expect(syms).toContain('alpha')
    expect(syms).toContain('Beta')
    expect(syms).toContain('Gamma')
    const alpha = chunks.find((c) => c.symbol === 'alpha')!
    expect(alpha.kind).toBe('function')
    expect(alpha.startLine).toBeGreaterThanOrEqual(1)
    expect(alpha.endLine).toBeGreaterThanOrEqual(alpha.startLine)
  })

  it('detects const-arrow functions', () => {
    const src = 'export const doThing = async () => {\n  return 42\n}\n'
    const chunks = chunkFile('src/b.ts', src)
    expect(chunks.some((c) => c.symbol === 'doThing' && c.kind === 'function')).toBe(true)
  })

  it('splits markdown by headings', () => {
    const src = '# Title\ntext\n## Section A\naaa\n## Section B\nbbb\n'
    const chunks = chunkFile('README.md', src)
    const syms = chunks.map((c) => c.symbol)
    expect(syms).toEqual(expect.arrayContaining(['Section A', 'Section B']))
    expect(chunks.every((c) => c.kind === 'section')).toBe(true)
  })

  it('windows oversized declarations with overlap', () => {
    const body = Array.from({ length: 200 }, (_, i) => `  const x${i} = ${i}`).join('\n')
    const src = `function big() {\n${body}\n}\n`
    const chunks = chunkFile('src/big.ts', src)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.symbol === 'big')).toBe(true)
  })

  it('language detection by extension', () => {
    expect(languageForPath('a.py')).toBe('python')
    expect(languageForPath('a.go')).toBe('go')
    expect(languageForPath('a.rs')).toBe('rust')
    expect(languageForPath('a.tsx')).toBe('ts')
    expect(languageForPath('a.unknownext')).toBe('text')
  })

  it('chunks Python def/class', () => {
    const src = 'class Foo:\n    def bar(self):\n        return 1\n\ndef baz():\n    return 2\n'
    const chunks = chunkFile('pkg/mod.py', src)
    const syms = chunks.map((c) => c.symbol)
    expect(syms).toEqual(expect.arrayContaining(['Foo', 'baz']))
  })
})
