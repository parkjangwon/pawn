// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadProjectContext, readSkill, skillSummary } from '../skills'

const files = new Map<string, unknown>()

function dir(entries: Array<{ name: string; path: string; isDirectory?: boolean }>): Array<{ name: string; path: string; isDirectory: boolean }> {
  return entries.map((e) => ({ ...e, isDirectory: e.isDirectory ?? false }))
}

beforeEach(() => {
  files.clear()
  ;(window as any).api = {
    fs: {
      homeDir: vi.fn().mockResolvedValue('/home/user'),
      listDir: vi.fn().mockImplementation(async (path: string) => {
        const value = files.get(path)
        return Array.isArray(value) ? value : { error: 'ENOENT' }
      }),
      readFile: vi.fn().mockImplementation(async (path: string) => files.get(path) ?? { error: 'ENOENT' })
    }
  }
})

describe('loadProjectContext', () => {
  it('loads CLAUDE.md, AGENTS.md and rules into system additions', async () => {
    const root = '/p1/'
    files.set(`${root}CLAUDE.md`, 'claude rules')
    files.set(`${root}AGENTS.md`, 'agent rules')
    files.set(`${root}.claude/rules`, dir([
      { name: 'style.md', path: `${root}.claude/rules/style.md` },
      { name: 'notes.txt', path: `${root}.claude/rules/notes.txt` }
    ]))
    files.set(`${root}.claude/rules/style.md`, 'style guide')

    const ctx = await loadProjectContext(root)
    expect(ctx.systemAdditions).toContain('claude rules')
    expect(ctx.systemAdditions).toContain('agent rules')
    expect(ctx.systemAdditions).toContain('style guide')
    expect(ctx.systemAdditions.join('\n')).not.toContain('notes.txt')
  })

  it('loads skills from .claude/skills and resolves them by name', async () => {
    const root = '/p2/'
    files.set(`${root}.claude/skills`, dir([
      { name: 'pdf', path: `${root}.claude/skills/pdf`, isDirectory: true },
      { name: 'not-a-skill.txt', path: `${root}.claude/skills/not-a-skill.txt` }
    ]))
    files.set(`${root}.claude/skills/pdf/SKILL.md`, '---\ndescription: Parse PDFs\n---\nfull body')

    const ctx = await loadProjectContext(root)
    expect(ctx.skills).toHaveLength(1)
    expect(ctx.skills[0].name).toBe('pdf')
    expect(skillSummary(ctx.skills[0])).toBe('Parse PDFs')

    await expect(readSkill(root, 'pdf')).resolves.toContain('full body')
    await expect(readSkill(root, 'PDF')).resolves.toContain('full body')
    await expect(readSkill(root, 'missing')).resolves.toBeNull()
  })

  it('dedupes skills case-insensitively with project scope winning', async () => {
    const root = '/p3/'
    files.set('/home/user/.claude/skills', dir([{ name: 'shared', path: '/home/user/.claude/skills/shared', isDirectory: true }]))
    files.set('/home/user/.claude/skills/shared/SKILL.md', 'user version')
    files.set(`${root}.claude/skills`, dir([{ name: 'shared', path: `${root}.claude/skills/shared`, isDirectory: true }]))
    files.set(`${root}.claude/skills/shared/SKILL.md`, 'project version')

    const ctx = await loadProjectContext(root)
    expect(ctx.skills).toHaveLength(1)
    expect(ctx.skills[0].content).toBe('project version')
  })

  it('loads user-level ~/.agents AGENTS.md and skills', async () => {
    const root = '/p5/'
    files.set('/home/user/.agents/AGENTS.md', 'global agent rules')
    files.set('/home/user/.agents/skills', dir([{ name: 'git', path: '/home/user/.agents/skills/git', isDirectory: true }]))
    files.set('/home/user/.agents/skills/git/SKILL.md', '---\ndescription: Git helpers\n---\nfull body')

    const ctx = await loadProjectContext(root)
    expect(ctx.systemAdditions).toContain('[User ~/.agents/AGENTS.md]\nglobal agent rules')
    expect(ctx.skills).toHaveLength(1)
    expect(ctx.skills[0].name).toBe('git')
    await expect(readSkill(root, 'git')).resolves.toContain('full body')
  })

  it('prefers ~/.agents skills over ~/.claude on user-scope collisions', async () => {
    const root = '/p6/'
    files.set('/home/user/.claude/skills', dir([{ name: 'shared', path: '/home/user/.claude/skills/shared', isDirectory: true }]))
    files.set('/home/user/.claude/skills/shared/SKILL.md', 'claude version')
    files.set('/home/user/.agents/skills', dir([{ name: 'shared', path: '/home/user/.agents/skills/shared', isDirectory: true }]))
    files.set('/home/user/.agents/skills/shared/SKILL.md', 'agents version')

    const ctx = await loadProjectContext(root)
    expect(ctx.skills).toHaveLength(1)
    expect(ctx.skills[0].content).toBe('agents version')
  })

  it('caches context within the TTL', async () => {
    const root = '/p4/'
    files.set(`${root}CLAUDE.md`, 'v1')
    await loadProjectContext(root)
    files.set(`${root}CLAUDE.md`, 'v2')
    const ctx = await loadProjectContext(root)
    expect(ctx.systemAdditions).toEqual(['v1'])
  })

  it('returns empty context for a project with nothing to load', async () => {
    const ctx = await loadProjectContext('/empty/')
    expect(ctx).toEqual({ systemAdditions: [], skills: [] })
  })
})
