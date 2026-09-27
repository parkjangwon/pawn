import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isValidSkillId,
  listUserSkills,
  parseCount,
  parseLeaderboard,
  parseSkillPage,
  pickSkillFolder,
  removeUserSkill,
  safeSkillDirName
} from '../skillRegistry'

const tmps: string[] = []
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('skills.sh parsing', () => {
  it('reads leaderboard rows (id, name, installs)', () => {
    const row = (id: string, name: string, installs: string): string =>
      `<a class="x" href="/${id}"><div><span>1</span></div><div><h3 class="t">${name}</h3><p>${id.split('/').slice(0, 2).join('/')}</p></div><div><svg aria-label="Weekly installs: 1, 2"></svg></div><div><span class="n">${installs}</span></div></a>`
    const html = row('vercel-labs/skills/find-skills', 'find-skills', '3.6M') + row('anthropics/skills/pdf', 'pdf', '201.7K') + row('anthropics/skills/pdf', 'pdf', '1')
    expect(parseLeaderboard(html)).toEqual([
      { id: 'vercel-labs/skills/find-skills', name: 'find-skills', source: 'vercel-labs/skills', installs: 3_600_000 },
      { id: 'anthropics/skills/pdf', name: 'pdf', source: 'anthropics/skills', installs: 201_700 }
    ])
    expect(parseCount('1,234')).toBe(1234)
  })

  it('reads the description and first-seen date from a skill page', () => {
    const html = '<head><meta name="description" content="Work with PDF files &amp; forms"/></head><body><div><span>First Seen</span><span>Jan 20, 2026</span></div></body>'
    expect(parseSkillPage(html)).toEqual({ description: 'Work with PDF files & forms', firstSeen: '2026-01-20' })
    expect(parseSkillPage('<html></html>')).toEqual({ description: '' })
  })
})

describe('safety', () => {
  it('accepts only owner/repo/skill ids and plain folder names', () => {
    expect(isValidSkillId('anthropics/skills/pdf')).toBe(true)
    for (const bad of ['anthropics/skills', '../x/y', 'a/../b', 'a/b/..', 'a/b/.hidden', 'a/b/c/d', 'a/b/$(rm -rf ~)', 'a b/c/d']) expect(isValidSkillId(bad), bad).toBe(false)
    expect(safeSkillDirName('pdf')).toBe('pdf')
    expect(safeSkillDirName('my.skill-2')).toBe('my.skill-2')
    for (const bad of ['..', '.', '...', '.git', 'a/b', '', '~']) expect(safeSkillDirName(bad), bad).toBeNull()
  })
})

describe('locating the skill folder in a repo', () => {
  it('prefers the folder named after the skill, then frontmatter name, then a root SKILL.md', () => {
    const paths = ['skills/pdf/SKILL.md', 'skills/docx/SKILL.md', 'examples/pdf/SKILL.md']
    expect(pickSkillFolder(paths, 'pdf')).toBe('skills/pdf')
    expect(pickSkillFolder(['skills/pdf-tools/SKILL.md'], 'pdf', { 'skills/pdf-tools': 'pdf' })).toBe('skills/pdf-tools')
    expect(pickSkillFolder(['SKILL.md'], 'whatever')).toBe('')
    expect(pickSkillFolder(['skills/a/SKILL.md'], 'b')).toBeNull()
  })
})

describe('installed skills in ~/.agents/skills', () => {
  it('lists folders with a SKILL.md and removes only inside that directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pawn-home-'))
    tmps.push(home)
    const dir = join(home, '.agents', 'skills')
    await mkdir(join(dir, 'pdf'), { recursive: true })
    await writeFile(join(dir, 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n')
    await mkdir(join(dir, 'not-a-skill'), { recursive: true })
    expect(await listUserSkills(home)).toEqual(['pdf'])
    expect(await removeUserSkill('../../etc', home)).toMatchObject({ ok: false })
    expect(await removeUserSkill('missing', home)).toEqual({ ok: false, error: 'not installed' })
    expect(await removeUserSkill('pdf', home)).toEqual({ ok: true })
    await expect(stat(join(dir, 'pdf'))).rejects.toThrow()
    // Untouched: a folder without SKILL.md, and anything outside the skills dir.
    expect((await stat(join(dir, 'not-a-skill'))).isDirectory()).toBe(true)
    void readFile
  })
})

describe('installing from a repo (local git, no network)', () => {
  it('copies only that skill folder to ~/.agents/skills/<name>, finds renamed folders by frontmatter', async () => {
    const { execFileSync } = await import('child_process')
    const { installRegistrySkill } = await import('../skillRegistry')
    const root = await mkdtemp(join(tmpdir(), 'pawn-repo-'))
    tmps.push(root)
    const repo = join(root, 'acme', 'skills')
    const put = async (p: string, text: string): Promise<void> => {
      await mkdir(join(repo, p, '..'), { recursive: true })
      await writeFile(join(repo, p), text)
    }
    await put('skills/pdf/SKILL.md', '---\nname: pdf\ndescription: PDFs\n---\n# PDF\n')
    await put('skills/pdf/scripts/merge.py', 'print(1)\n')
    await put('skills/docx/SKILL.md', '---\nname: docx\n---\n')
    await put('catalog/office/sheet-tools/SKILL.md', '---\nname: "excel"\n---\n# Excel\n')
    const git = (...a: string[]): void => void execFileSync('git', a, { cwd: repo, stdio: 'ignore' })
    git('init', '-q')
    git('add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    const home = join(root, 'home')
    const url = (o: string, r: string): string => `file://${join(root, o, r)}`

    const r = await installRegistrySkill('acme/skills/pdf', home, url)
    expect(r).toMatchObject({ ok: true, name: 'pdf', path: join(home, '.agents', 'skills', 'pdf') })
    expect(await readFile(join(home, '.agents/skills/pdf/scripts/merge.py'), 'utf8')).toBe('print(1)\n')
    await expect(stat(join(home, '.agents/skills/docx'))).rejects.toThrow()
    await expect(stat(join(home, '.agents/skills/pdf/.git'))).rejects.toThrow()

    const renamed = await installRegistrySkill('acme/skills/excel', home, url)
    expect(renamed).toMatchObject({ ok: true, name: 'excel' })
    expect(await readFile(join(home, '.agents/skills/excel/SKILL.md'), 'utf8')).toContain('# Excel')
    expect(await listUserSkills(home)).toEqual(['excel', 'pdf'])

    expect(await installRegistrySkill('acme/skills/nope', home, url)).toMatchObject({ ok: false })
    expect(await installRegistrySkill('../skills/pdf', home, url)).toEqual({ ok: false, error: 'invalid skill id' })
  }, 60_000)
})

describe('site (well-known) skills', () => {
  it('parses both id forms to one canonical site id', async () => {
    const { parseSkillId, canonicalId, safeRelativeFile } = await import('../skillRegistry')
    expect(parseSkillId('open.feishu.cn/lark-doc')).toEqual({ kind: 'site', domain: 'open.feishu.cn', skill: 'lark-doc' })
    expect(parseSkillId('site/open.feishu.cn/lark-doc')).toEqual({ kind: 'site', domain: 'open.feishu.cn', skill: 'lark-doc' })
    expect(canonicalId('open.feishu.cn/lark-doc')).toBe('site/open.feishu.cn/lark-doc')
    expect(parseSkillId('anthropics/skills/pdf')).toMatchObject({ kind: 'github' })
    for (const bad of ['localhost/x', 'site/-bad.com/x', 'site/a.com/..', 'a.com/.git']) expect(parseSkillId(bad), bad).toBeNull()
    expect(safeRelativeFile('references/genres/email.md')).toBe(true)
    for (const bad of ['../x.md', '/etc/passwd', 'a/../../b', '.git/config', 'a\\b']) expect(safeRelativeFile(bad), bad).toBe(false)
  })

  it('downloads the files the site lists into ~/.agents/skills/<name>, refusing unsafe paths', async () => {
    const { installRegistrySkill } = await import('../skillRegistry')
    const home = await mkdtemp(join(tmpdir(), 'pawn-home-'))
    tmps.push(home)
    const files: Record<string, string> = {
      'https://docs.example.com/.well-known/skills/index.json': JSON.stringify({ skills: [{ name: 'doc-tool', files: ['SKILL.md', 'references/how.md'] }, { name: 'evil', files: ['SKILL.md', '../../escape.md'] }] }),
      'https://docs.example.com/.well-known/skills/doc-tool/SKILL.md': '---\nname: doc-tool\n---\n# Doc\n',
      'https://docs.example.com/.well-known/skills/doc-tool/references/how.md': 'steps\n'
    }
    const fetchText = async (url: string): Promise<{ ok: boolean; status: number; text: string }> =>
      url in files ? { ok: true, status: 200, text: files[url] } : { ok: false, status: 404, text: '' }
    const r = await installRegistrySkill('site/docs.example.com/doc-tool', home, undefined, fetchText)
    expect(r).toEqual({ ok: true, name: 'doc-tool', path: join(home, '.agents/skills/doc-tool') })
    expect(await readFile(join(home, '.agents/skills/doc-tool/references/how.md'), 'utf8')).toBe('steps\n')
    expect(await installRegistrySkill('docs.example.com/evil', home, undefined, fetchText)).toEqual({ ok: false, error: 'evil: unsafe file path in index' })
    expect(await installRegistrySkill('docs.example.com/missing', home, undefined, fetchText)).toMatchObject({ ok: false })
    await expect(stat(join(home, 'escape.md'))).rejects.toThrow()
  })
})
