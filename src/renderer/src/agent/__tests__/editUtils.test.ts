import { describe, it, expect } from 'vitest'
import { applyEdit, countOccurrences } from '../editUtils'

describe('countOccurrences', () => {
  it('counts non-overlapping', () => {
    expect(countOccurrences('ababab', 'ab')).toBe(3)
  })
})

describe('applyEdit', () => {
  it('exact unique replace', () => {
    const r = applyEdit('one two three', 'two', 'TWO')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.updated).toBe('one TWO three')
      expect(r.mode).toBe('exact')
    }
  })

  it('replace_all', () => {
    const r = applyEdit('a x a x', 'x', 'Y', true)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.updated).toBe('a Y a Y')
      expect(r.replacements).toBe(2)
    }
  })

  it('rejects ambiguous without replace_all', () => {
    const r = applyEdit('x x', 'x', 'y')
    expect(r.ok).toBe(false)
  })

  it('flex-matches indentation drift', () => {
    const file = 'function f() {\n  const x = 1\n  return x\n}\n'
    const oldStr = 'function f() {\n    const x = 1\n    return x\n}'
    const newStr = 'function f() {\n  const x = 2\n  return x\n}'
    const r = applyEdit(file, oldStr, newStr)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('flex_ws')
      expect(r.updated).toContain('const x = 2')
    }
  })

  it('hints similar lines on total miss', () => {
    const r = applyEdit('const foo = 1\nconst bar = 2\n', 'const foo = 99', 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.hint || r.error).toMatch(/foo|not found/i)
    }
  })
})
