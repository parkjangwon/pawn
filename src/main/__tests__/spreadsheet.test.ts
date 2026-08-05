import { describe, it, expect } from 'vitest'
import { parseCsv } from '../spreadsheet'

describe('parseCsv', () => {
  it('parses simple rows', () => {
    const { rows, truncated } = parseCsv('a,b\n1,2\n3,4\n', 10, 10)
    expect(truncated).toBe(false)
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('handles quoted commas', () => {
    const { rows } = parseCsv('name,note\n"Kim, A","hello, world"\n', 10, 10)
    expect(rows[1]).toEqual(['Kim, A', 'hello, world'])
  })

  it('respects max rows/cols', () => {
    const { rows, truncated } = parseCsv('a,b,c,d\n1,2,3,4\n5,6,7,8\n', 1, 2)
    expect(truncated).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(['a', 'b'])
  })
})
