import { describe, it, expect } from 'vitest'
import { skillSummary, buildProjectContextBlock, type LoadedSkill } from '../skills'

const skill = (name: string, content: string): LoadedSkill => ({ name, content, source: `/skills/${name}/SKILL.md`, kind: 'skill' })

describe('skillSummary', () => {
  it('extracts the front-matter description', () => {
    const content = '---\ndescription: Parse PDF files and extract tables\n---\n# Body\ninstructions...'
    expect(skillSummary(skill('pdf', content))).toBe('Parse PDF files and extract tables')
  })

  it('strips quotes from descriptions', () => {
    const content = '---\ndescription: "Quoted summary"\n---\nbody'
    expect(skillSummary(skill('q', content))).toBe('Quoted summary')
  })

  it('falls back to the first prose line without front matter', () => {
    const content = '# Title\n\nThis is the first useful line.\nMore text.'
    expect(skillSummary(skill('p', content))).toBe('This is the first useful line.')
  })

  it('returns empty for a blank skill', () => {
    expect(skillSummary(skill('empty', '   '))).toBe('')
  })
})

describe('buildProjectContextBlock', () => {
  it('renders system additions', () => {
    const out = buildProjectContextBlock({ systemAdditions: ['Rule one.'], skills: [] })
    expect(out).toContain('Rule one.')
  })

  it('renders skills with summaries and the load_skill hint', () => {
    const out = buildProjectContextBlock({
      systemAdditions: [],
      skills: [skill('pdf', '---\ndescription: Parse PDFs\n---')]
    })
    expect(out).toContain('- pdf: Parse PDFs')
    expect(out).toContain('Call load_skill')
  })

  it('returns empty when there is nothing to add', () => {
    expect(buildProjectContextBlock({ systemAdditions: [], skills: [] })).toBe('')
  })
})
