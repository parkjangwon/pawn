import { describe, it, expect } from 'vitest'
import { dedupeByName, formatInstalls, pageCount, pageSlice, sortSkills, type StoreSkill } from '../skillStore'

const s = (id: string, installs: number, firstSeen?: string): StoreSkill => ({ id, name: id.split('/')[2], source: id.split('/').slice(0, 2).join('/'), installs, ...(firstSeen ? { firstSeen } : {}) })

describe('skill store helpers', () => {
  const list = [s('a/r/zeta', 10, '2026-01-01'), s('a/r/alpha', 500), s('b/r/mid', 90, '2026-03-05')]
  it('sorts by popular, newest (unknown dates last), name', () => {
    expect(sortSkills(list, 'popular').map((x) => x.name)).toEqual(['alpha', 'mid', 'zeta'])
    expect(sortSkills(list, 'newest').map((x) => x.name)).toEqual(['mid', 'zeta', 'alpha'])
    expect(sortSkills(list, 'name').map((x) => x.name)).toEqual(['alpha', 'mid', 'zeta'])
    expect(list.map((x) => x.name)).toEqual(['zeta', 'alpha', 'mid'])
  })
  it('pages and clamps', () => {
    const many = Array.from({ length: 25 }, (_, i) => i)
    expect(pageCount(25)).toBe(3)
    expect(pageCount(0)).toBe(1)
    expect(pageSlice(many, 3)).toEqual([24])
    expect(pageSlice(many, 9)).toEqual([24])
    expect(pageSlice(many, 0)).toEqual(many.slice(0, 12))
  })
  it('dedupes identical ids and formats counts', () => {
    expect(dedupeByName([s('a/r/x', 1), s('a/r/x', 7)])).toEqual([s('a/r/x', 7)])
    expect([formatInstalls(3_600_000), formatInstalls(201_700), formatInstalls(950)]).toEqual(['3.6M', '201.7K', '950'])
  })
})
