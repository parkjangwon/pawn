/**
 * Public skill registry (skills.sh) — browse, install, remove.
 *
 * - Search: `GET https://skills.sh/api/search?q=&limit=` (≥2 chars) → name,
 *   source repo (owner/repo), installs. With no query, the home-page
 *   leaderboard (most installed) is parsed instead.
 * - Details: each skill page (`https://skills.sh/<owner>/<repo>/<skill>`)
 *   carries the SKILL.md description (meta description) and a "First Seen"
 *   date, fetched lazily per visible row and cached.
 * - Install, two kinds of source:
 *   · GitHub (`owner/repo/skill`): blob-less sparse git clone, locate the
 *     folder whose SKILL.md is that skill, copy just that folder.
 *   · Site (`<domain>/<skill>`, leaderboard `site/<domain>/<skill>`): the
 *     well-known layout — /.well-known/skills/index.json lists each skill's
 *     files, served from /.well-known/skills/<name>/<file>.
 *   Either way the skill lands in ~/.agents/skills/<name> (the
 *   ecosystem-standard user path Pawn already loads).
 * - Remove: delete ~/.agents/skills/<name> (only inside that directory).
 *
 * Only fixed skills.sh / github.com URLs are contacted; ids are validated so
 * nothing user-typed reaches a URL path or a command line unchecked.
 */
import { execFile } from 'child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

const REGISTRY = 'https://skills.sh'
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/
const UA = 'Pawn (skills browser)'

export interface RegistrySkill {
  /** owner/repo/skill */
  id: string
  name: string
  /** owner/repo */
  source: string
  installs: number
}

export interface SkillDetails {
  description: string
  /** ISO date (first seen on skills.sh), when known. */
  firstSeen?: string
}

/** A path segment that can't climb or hide: allowed chars, not "." / "..", no leading dot. */
function safeSegment(p: string): boolean {
  return SEGMENT.test(p) && !/^\.+$/.test(p) && !p.startsWith('.')
}

const DOMAIN = /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i

export type SkillSource =
  | { kind: 'github'; owner: string; repo: string; skill: string }
  | { kind: 'site'; domain: string; skill: string }

/**
 * `owner/repo/skill` → GitHub; `<domain>/<skill>` or `site/<domain>/<skill>`
 * → a site serving /.well-known/skills. Anything else → null.
 */
export function parseSkillId(id: string): SkillSource | null {
  const parts = id.split('/')
  if (parts[0] === 'site') {
    // skills.sh's prefix for non-GitHub sources — never a GitHub owner here.
    return parts.length === 3 && DOMAIN.test(parts[1]) && safeSegment(parts[2]) ? { kind: 'site', domain: parts[1].toLowerCase(), skill: parts[2] } : null
  }
  if (parts.length === 2 && DOMAIN.test(parts[0]) && safeSegment(parts[1])) {
    return { kind: 'site', domain: parts[0].toLowerCase(), skill: parts[1] }
  }
  if (parts.length === 3 && parts.every(safeSegment)) return { kind: 'github', owner: parts[0], repo: parts[1], skill: parts[2] }
  return null
}

export function isValidSkillId(id: string): boolean {
  return parseSkillId(id) !== null
}

/** Canonical id: site skills as `site/<domain>/<skill>` (the skills.sh page path). */
export function canonicalId(id: string): string {
  const src = parseSkillId(id)
  return src?.kind === 'site' ? `site/${src.domain}/${src.skill}` : id
}

/** Safe folder name for ~/.agents/skills (the skill's own name). */
export function safeSkillDirName(name: string): string | null {
  const n = name.trim()
  return safeSegment(n) ? n : null
}

export function userSkillsDir(home = homedir()): string {
  return join(home, '.agents', 'skills')
}

async function getText(url: string, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/html' }, redirect: 'follow' })
    return { ok: res.ok, status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

function asSkill(raw: Record<string, unknown>): RegistrySkill | null {
  const src = parseSkillId(String(raw.id || ''))
  if (!src) return null
  return {
    id: canonicalId(String(raw.id)),
    name: String(raw.name || src.skill).slice(0, 120),
    source: src.kind === 'site' ? src.domain : `${src.owner}/${src.repo}`,
    installs: Number(raw.installs) || 0
  }
}

export async function searchRegistry(query: string, limit = 120): Promise<{ skills: RegistrySkill[]; error?: string }> {
  const q = query.trim()
  if (q.length < 2) return leaderboard()
  const url = `${REGISTRY}/api/search?${new URLSearchParams({ q, limit: String(Math.min(200, Math.max(10, limit))) })}`
  try {
    const r = await getText(url)
    if (!r.ok) return { skills: [], error: `skills.sh ${r.status}` }
    const data = JSON.parse(r.text) as { skills?: Record<string, unknown>[]; error?: string }
    if (data.error) return { skills: [], error: data.error }
    return { skills: (data.skills || []).map(asSkill).filter((s): s is RegistrySkill => !!s) }
  } catch (e) {
    return { skills: [], error: String((e as Error)?.message || e) }
  }
}

/** Parse the home-page leaderboard (all-time installs) — rows link to /owner/repo/skill. */
export function parseLeaderboard(html: string): RegistrySkill[] {
  const out: RegistrySkill[] = []
  const seen = new Set<string>()
  // One leaderboard row = one <a href="/…">…</a>; splitting on "<a " keeps a
  // match from ever spanning into the next link (nav links like /agent/zed).
  for (const chunk of html.split('<a ').slice(1)) {
    const href = /^[^>]*href="\/([^"]+)"/.exec(chunk)?.[1]
    const name = /<h3[^>]*>([^<]+)<\/h3>/.exec(chunk)?.[1]
    if (!href || !name) continue
    const src = parseSkillId(href)
    if (!src) continue
    const id = canonicalId(href)
    if (seen.has(id)) continue
    // Installs: the last number-ish text in the row (after the sparkline).
    const row = chunk.indexOf('</a>') > 0 ? chunk.slice(0, chunk.indexOf('</a>')) : chunk
    const counts = Array.from(row.matchAll(/>\s*([\d.,]+[KM]?)\s*</g), (m) => m[1])
    seen.add(id)
    out.push({ id, name: name.trim(), source: src.kind === 'site' ? src.domain : `${src.owner}/${src.repo}`, installs: parseCount(counts[counts.length - 1] || '0') })
  }
  return out
}

export function parseCount(s: string): number {
  const t = s.replace(/,/g, '').trim()
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return 0
  if (/M$/i.test(t)) return Math.round(n * 1_000_000)
  if (/K$/i.test(t)) return Math.round(n * 1_000)
  return Math.round(n)
}

async function leaderboard(): Promise<{ skills: RegistrySkill[]; error?: string }> {
  try {
    const r = await getText(`${REGISTRY}/`)
    if (!r.ok) return { skills: [], error: `skills.sh ${r.status}` }
    return { skills: parseLeaderboard(r.text) }
  } catch (e) {
    return { skills: [], error: String((e as Error)?.message || e) }
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function parseSkillPage(html: string): SkillDetails {
  const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] || ''
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const seen = /First Seen\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text)?.[1]
  const d = seen ? new Date(`${seen} UTC`) : null
  return {
    description: decodeEntities(desc).trim(),
    ...(d && !Number.isNaN(d.getTime()) ? { firstSeen: d.toISOString().slice(0, 10) } : {})
  }
}

const detailsCache = new Map<string, SkillDetails>()

export async function skillDetails(rawId: string): Promise<SkillDetails | { error: string }> {
  if (!isValidSkillId(rawId)) return { error: 'invalid skill id' }
  const id = canonicalId(rawId)
  const hit = detailsCache.get(id)
  if (hit) return hit
  try {
    const r = await getText(`${REGISTRY}/${id}`)
    if (!r.ok) return { error: `skills.sh ${r.status}` }
    const d = parseSkillPage(r.text)
    detailsCache.set(id, d)
    return d
  } catch (e) {
    return { error: String((e as Error)?.message || e) }
  }
}

function run(file: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // No prompts: a private/missing repo must fail fast, never wait on a credential dialog.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', SSH_ASKPASS: 'echo' }
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, env }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: unknown; killed?: boolean }) | null
      const timedOut = !!e?.killed
      resolve({
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        stdout: String(stdout),
        stderr: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s (slow network?)` : String(stderr)
      })
    })
  })
}

/**
 * Which folder in the repo is this skill? Prefer a SKILL.md whose parent
 * folder is the skill id, then one whose frontmatter `name` matches, then a
 * root SKILL.md (single-skill repos).
 */
export function pickSkillFolder(skillMdPaths: string[], skillId: string, names: Record<string, string> = {}): string | null {
  const dirs = skillMdPaths.filter((p) => /(^|\/)SKILL\.md$/i.test(p)).map((p) => p.replace(/\/?SKILL\.md$/i, ''))
  const byFolder = dirs.filter((d) => d.split('/').pop()?.toLowerCase() === skillId.toLowerCase())
  if (byFolder.length) return byFolder.sort((a, b) => a.length - b.length)[0]
  const byName = dirs.filter((d) => (names[d] || '').toLowerCase() === skillId.toLowerCase())
  if (byName.length) return byName.sort((a, b) => a.length - b.length)[0]
  if (dirs.includes('')) return ''
  return null
}

function frontmatterName(md: string): string {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(md)?.[1] || ''
  return (/^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(fm)?.[1] || '').trim()
}

type InstallResult = { ok: true; name: string; path: string } | { ok: false; error: string }
type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text: string }>

const SITE_MAX_FILES = 200
const SITE_MAX_BYTES = 5 * 1024 * 1024

/** A file path from a well-known index: relative, no climbing, no hidden dirs. */
export function safeRelativeFile(p: string): boolean {
  if (!p || p.length > 300 || p.startsWith('/') || p.includes('\\')) return false
  return p.split('/').every((seg) => SEGMENT.test(seg) && !seg.startsWith('.'))
}

async function installFromSite(domain: string, skill: string, home: string, fetchText: FetchText): Promise<InstallResult> {
  const base = `https://${domain}/.well-known/skills`
  const idx = await fetchText(`${base}/index.json`)
  if (!idx.ok) return { ok: false, error: `${domain} has no skill index (${idx.status})` }
  let entry: { name?: string; files?: unknown } | undefined
  try {
    entry = ((JSON.parse(idx.text) as { skills?: { name?: string; files?: unknown }[] }).skills || []).find((x) => x?.name === skill)
  } catch {
    return { ok: false, error: `${domain}: invalid skill index` }
  }
  if (!entry) return { ok: false, error: `${domain} does not list "${skill}"` }
  const files = (Array.isArray(entry.files) ? entry.files : ['SKILL.md']).map(String)
  if (!files.includes('SKILL.md')) files.unshift('SKILL.md')
  if (files.length > SITE_MAX_FILES) return { ok: false, error: `${skill} has too many files (${files.length})` }
  if (!files.every(safeRelativeFile)) return { ok: false, error: `${skill}: unsafe file path in index` }
  const name = safeSkillDirName(skill)
  if (!name) return { ok: false, error: 'invalid skill name' }
  const tmp = await mkdtemp(join(tmpdir(), 'pawn-skill-'))
  try {
    // A few files at a time: fast, without hammering the site.
    let total = 0
    let failure: string | null = null
    let next = 0
    const worker = async (): Promise<void> => {
      while (!failure && next < files.length) {
        const f = files[next++]
        const r = await fetchText(`${base}/${encodeURIComponent(skill)}/${f.split('/').map(encodeURIComponent).join('/')}`)
        if (!r.ok) {
          failure = `Download failed: ${f} (${r.status})`
          return
        }
        total += Buffer.byteLength(r.text)
        if (total > SITE_MAX_BYTES) {
          failure = `${skill} is larger than 5 MB`
          return
        }
        await mkdir(join(tmp, f, '..'), { recursive: true })
        await writeFile(join(tmp, f), r.text)
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker))
    if (failure) return { ok: false, error: failure }
    const dest = join(userSkillsDir(home), name)
    await mkdir(userSkillsDir(home), { recursive: true })
    await rm(dest, { recursive: true, force: true })
    await cp(tmp, dest, { recursive: true })
    return { ok: true, name, path: dest }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

export async function installRegistrySkill(
  rawId: string,
  home = homedir(),
  /** Tests only: clone from a local repo instead of github.com. */
  repoUrl?: (owner: string, repo: string) => string,
  /** Tests only: fetch for well-known site skills. */
  fetchText: FetchText = (url) => getText(url)
): Promise<InstallResult> {
  const source = parseSkillId(rawId)
  if (!source) return { ok: false, error: 'invalid skill id' }
  if (source.kind === 'site') {
    try {
      return await installFromSite(source.domain, source.skill, home, fetchText)
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) }
    }
  }
  const { owner, repo, skill: skillId } = source
  const tmp = await mkdtemp(join(tmpdir(), 'pawn-skill-'))
  try {
    const src = join(tmp, 'repo')
    const url = repoUrl ? repoUrl(owner, repo) : `https://github.com/${owner}/${repo}.git`
    const clone = await run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--quiet', url, src], tmp)
    if (clone.code !== 0) return { ok: false, error: `Could not download ${owner}/${repo}: ${(clone.stderr || clone.stdout).trim().slice(0, 300)}` }
    const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], src, 30_000)
    const paths = tree.stdout.split('\n').filter((p) => /(^|\/)SKILL\.md$/i.test(p))
    let folder = pickSkillFolder(paths, skillId)
    if (folder === null && paths.length) {
      // Folder names differ from the skill name: read frontmatter names.
      await run('git', ['sparse-checkout', 'set', '--no-cone', ...paths.map((p) => `/${p}`)], src, 60_000)
      const names: Record<string, string> = {}
      for (const p of paths) {
        const md = await readFile(join(src, p), 'utf8').catch(() => '')
        names[p.replace(/\/?SKILL\.md$/i, '')] = frontmatterName(md)
      }
      folder = pickSkillFolder(paths, skillId, names)
    }
    if (folder === null) return { ok: false, error: `No SKILL.md for "${skillId}" in ${owner}/${repo}` }
    const co = await run('git', ['sparse-checkout', 'set', '--no-cone', folder ? `/${folder}/` : '/*'], src, 120_000)
    if (co.code !== 0) return { ok: false, error: `Download failed: ${co.stderr.trim().slice(0, 300)}` }
    const from = folder ? join(src, folder) : src
    const md = await readFile(join(from, 'SKILL.md'), 'utf8').catch(() => '')
    const name = safeSkillDirName(frontmatterName(md) || skillId) || safeSkillDirName(skillId)
    if (!name || !md) return { ok: false, error: 'The downloaded skill has no SKILL.md' }
    const dest = join(userSkillsDir(home), name)
    await mkdir(userSkillsDir(home), { recursive: true })
    await rm(dest, { recursive: true, force: true })
    await cp(from, dest, { recursive: true, filter: (p) => !/(^|[\\/])\.git([\\/]|$)/.test(p) })
    return { ok: true, name, path: dest }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

export async function removeUserSkill(name: string, home = homedir()): Promise<{ ok: boolean; error?: string }> {
  const n = safeSkillDirName(name)
  if (!n) return { ok: false, error: 'invalid skill name' }
  const dest = join(userSkillsDir(home), n)
  try {
    const s = await stat(dest).catch(() => null)
    if (!s?.isDirectory()) return { ok: false, error: 'not installed' }
    await rm(dest, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** Folder names under ~/.agents/skills that hold a SKILL.md. */
export async function listUserSkills(home = homedir()): Promise<string[]> {
  const dir = userSkillsDir(home)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const ok = await stat(join(dir, e.name, 'SKILL.md')).then(() => true).catch(() => false)
    if (ok) out.push(e.name)
  }
  return out.sort()
}
