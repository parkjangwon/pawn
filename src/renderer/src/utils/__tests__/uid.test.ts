import { describe, it, expect } from 'vitest'
import { uid } from '../uid'

describe('uid', () => {
  it('prepends the given prefix', () => {
    expect(uid('tool-').startsWith('tool-')).toBe(true)
  })

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()))
    expect(ids.size).toBe(1000)
  })

  it('is monotonic within the same millisecond', () => {
    const a = uid()
    const b = uid()
    const c = uid()
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })
})
