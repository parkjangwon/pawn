// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  detectRepoLayout, repoNameFromUrl, mergeInstalledPlugins,
  installSkillFromRepo, type RepoProbe
} from '../skillInstaller'

const probe = (overrides: Partial<RepoProbe> = {}): RepoProbe => ({
  hasPluginMarker: false,
  rootSkill: false,
  skillsDir: [],
  claudeSkillsDir: [],
  hasSetupScript: false,
  ...overrides
})

describe('detectRepoLayout', () => {
  it('prioritizes plugin marker over skill layouts', () => {
    expect(detectRepoLayout(probe({ hasPluginMarker: true, rootSkill: true }))).toBe('plugin')
  })

  it('detects skills/ and .claude/skills/ directories and root SKILL.md', () => {
    expect(detectRepoLayout(probe({ skillsDir: ['pdf'] }))).toBe('skills-dir')
    expect(detectRepoLayout(probe({ claudeSkillsDir: ['git'] }))).toBe('claude-skills-dir')
    expect(detectRepoLayout(probe({ rootSkill: true }))).toBe('root-skill')
  })

  it('returns unknown when nothing is recognizable', () => {
    expect(detectRepoLayout(probe())).toBe('unknown')
  })
})

describe('repoNameFromUrl', () => {
  it('derives a safe name from GitHub URLs and strips .git', () => {
    expect(repoNameFromUrl('https://github.com/fivetaku/insane-search')).toBe('insane-search')
    expect(repoNameFromUrl('https://github.com/fivetaku/insane-search.git')).toBe('insane-search')
  })

  it('rejects non-URLs and unsafe names', () => {
    expect(repoNameFromUrl('not a url')).toBeNull()
    expect(repoNameFromUrl('https://example.com/only-one-segment')).toBeNull()
    expect(repoNameFromUrl('https://example.com/a/../evil')).toBeNull()
  })
})

describe('mergeInstalledPlugins', () => {
  it('creates a manifest when none exists', () => {
    expect(mergeInstalledPlugins(null, 'insane-search', '/home/u/.claude/plugins/insane-search')).toEqual({
      plugins: {
        'insane-search': [{ scope: 'user', installPath: '/home/u/.claude/plugins/insane-search' }]
      }
    })
  })

  it('preserves existing entries and other manifest fields', () => {
    const existing = {
      version: 1,
      plugins: {
        'existing-plugin': [{ scope: 'user', installPath: '/old' }]
      }
    }
    const out = mergeInstalledPlugins(existing, 'new-plugin', '/new')
    expect(out.version).toBe(1)
    const plugins = out.plugins as Record<string, unknown>
    expect(plugins['existing-plugin']).toEqual([{ scope: 'user', installPath: '/old' }])
    expect(plugins['new-plugin']).toEqual([{ scope: 'user', installPath: '/new' }])
  })

  it('is idempotent for the same installPath', () => {
    const existing = {
      plugins: { 'insane-search': [{ scope: 'user', installPath: '/same' }] }
    }
    expect(mergeInstalledPlugins(existing, 'insane-search', '/same')).toEqual(existing)
  })
})

describe('installSkillFromRepo', () => {
  const fsMock = {
    homeDir: vi.fn(),
    listDir: vi.fn(),
    mkdir: vi.fn().mockResolvedValue({ ok: true }),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue({ ok: true })
  }
  const shellMock = { exec: vi.fn() }

  beforeEach(() => {
    ;(window as any).api = {
      platform: 'darwin',
      fs: fsMock,
      shell: shellMock
    }
    fsMock.homeDir.mockReset().mockResolvedValue('/home/user')
    fsMock.listDir.mockReset()
    fsMock.readFile.mockReset()
    shellMock.exec.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
  })

  it('rejects non-http(s) sources', async () => {
    const res = await installSkillFromRepo('/tmp/local', 'user')
    expect(res.isError).toBe(true)
  })

  it('installs a root-SKILL.md repo into ~/.agents/skills', async () => {
    fsMock.listDir.mockResolvedValue([
      { name: 'SKILL.md', path: '/home/user/.pawn/tmp/x/src/SKILL.md', isDirectory: false }
    ])
    const res = await installSkillFromRepo('https://github.com/owner/my-skill', 'user')
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('/home/user/.agents/skills/my-skill')
    expect(res.content).toContain('root-skill')
    expect(shellMock.exec).toHaveBeenCalledWith(expect.stringContaining('git clone'))
    expect(fsMock.mkdir).toHaveBeenCalledWith('/home/user/.agents/skills/my-skill')
  })

  it('installs a plugin into ~/.claude/plugins and updates the manifest', async () => {
    fsMock.listDir.mockResolvedValue([
      { name: '.claude-plugin', path: '/home/user/.pawn/tmp/x/src/.claude-plugin', isDirectory: true }
    ])
    fsMock.readFile.mockResolvedValue(JSON.stringify({ plugins: {} }))
    const res = await installSkillFromRepo('https://github.com/owner/awesome-plugin', 'user')
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('/home/user/.claude/plugins/awesome-plugin')
    const manifestWrite = fsMock.writeFile.mock.calls.find(([p]) => String(p).endsWith('installed_plugins.json'))
    expect(manifestWrite).toBeDefined()
    if (!manifestWrite) throw new Error('manifest write missing')
    const parsed = JSON.parse(manifestWrite[1] as string)
    expect((parsed.plugins as Record<string, Array<{ installPath: string }>>)['awesome-plugin'][0].installPath)
      .toBe('/home/user/.claude/plugins/awesome-plugin')
  })

  it('uses the active project for project scope', async () => {
    fsMock.listDir.mockResolvedValue([
      { name: 'SKILL.md', path: '/home/user/.pawn/tmp/x/src/SKILL.md', isDirectory: false }
    ])
    const res = await installSkillFromRepo('https://github.com/owner/proj-skill', 'project', '/work/app')
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('/work/app/.claude/skills/proj-skill')
  })
})
