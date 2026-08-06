import { describe, it, expect } from 'vitest'
import { verifyEditedSource, formatVerifyNote } from '../editVerify'

describe('editVerify', () => {
  it('accepts balanced JS', () => {
    const r = verifyEditedSource('a.ts', 'export function f() { return 1 }')
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('flags unbalanced braces', () => {
    const r = verifyEditedSource('a.ts', 'function f() { return 1')
    expect(r.ok).toBe(false)
    expect(r.warnings.some((w) => w.includes('{'))).toBe(true)
    expect(formatVerifyNote('a.ts', r)).toContain('structure_check')
  })

  it('flags mixed python indentation', () => {
    const r = verifyEditedSource('a.py', 'def f():\n\treturn 1\n    return 2\n')
    expect(r.ok).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/tabs|spaces/i)
  })
})
