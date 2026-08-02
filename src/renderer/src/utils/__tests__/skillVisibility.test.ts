// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadDisabledSkillNames, saveDisabledSkillNames, setSkillEnabled,
  isSkillEnabled, filterEnabledSkills
} from '../skillVisibility'

beforeEach(() => {
  localStorage.clear()
})

describe('skillVisibility', () => {
  it('defaults to every skill enabled', () => {
    expect(loadDisabledSkillNames().size).toBe(0)
    expect(isSkillEnabled('cso')).toBe(true)
    expect(filterEnabledSkills([{ name: 'cso' }, { name: 'pdf' }]).map((s) => s.name))
      .toEqual(['cso', 'pdf'])
  })

  it('disables and re-enables case-insensitively', () => {
    setSkillEnabled('CSO', false)
    expect(isSkillEnabled('cso')).toBe(false)
    expect(loadDisabledSkillNames().has('cso')).toBe(true)

    setSkillEnabled('Cso', true)
    expect(isSkillEnabled('cso')).toBe(true)
    expect(loadDisabledSkillNames().size).toBe(0)
  })

  it('persists the choice across a reload', () => {
    setSkillEnabled('pdf', false)
    expect(loadDisabledSkillNames().has('pdf')).toBe(true)
    expect(isSkillEnabled('pdf')).toBe(false)
  })

  it('ignores corrupt or non-string localStorage payloads', () => {
    localStorage.setItem('pawn-disabled-skills', '{not json')
    expect(loadDisabledSkillNames().size).toBe(0)

    localStorage.setItem('pawn-disabled-skills', JSON.stringify([1, 'ok', null]))
    const names = loadDisabledSkillNames()
    expect(names.has('ok')).toBe(true)
    expect(names.size).toBe(1)
  })

  it('filters using an explicit disabled set', () => {
    const disabled = new Set(['pdf'])
    expect(filterEnabledSkills([{ name: 'pdf' }, { name: 'cso' }], disabled).map((s) => s.name))
      .toEqual(['cso'])
    expect(saveDisabledSkillNames(disabled)).toBeUndefined()
  })
})
