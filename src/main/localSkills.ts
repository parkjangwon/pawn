/**
 * User skills written by Pawn itself (Record & Replay drafts, agent
 * refinements) into ~/.agents/skills/<name>/SKILL.md — the shared Agent
 * Skills location, so Claude Code / Codex-style agents can use them too.
 */

import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { userSkillsDir } from './skillRegistry'

export const MAX_SKILL_BYTES = 200_000
/** Agent Skills spec: lowercase letters, digits, hyphens; ≤ 64 chars. */
export const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function slugifySkillName(raw: string): string {
  const s = String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return s
}

/** `name:` / `description:` from YAML front matter (flat keys only). */
export function frontMatter(content: string): { name?: string; description?: string; body: string; hasFrontMatter: boolean } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!m) return { body: content, hasFrontMatter: false }
  const out: { name?: string; description?: string } = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    // Folded / literal block scalars: take the indented lines that follow.
    if (v === '>' || v === '|' || v === '>-' || v === '|-') {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim())
      v = parts.join(v.startsWith('>') ? ' ' : '\n')
    }
    v = v.replace(/^(["'])([\s\S]*)\1$/, '$2')
    out[kv[1] as 'name' | 'description'] = v
  }
  return { ...out, body: content.slice(m[0].length), hasFrontMatter: true }
}

export function validateSkill(name: string, content: string): { ok: true } | { ok: false; error: string } {
  if (!SKILL_NAME_RE.test(name)) return { ok: false, error: `Invalid skill name "${name}" (lowercase letters, digits and hyphens, up to 64 characters)` }
  if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'Skill content is empty' }
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) return { ok: false, error: `Skill is too large (max ${MAX_SKILL_BYTES / 1000} KB)` }
  const fm = frontMatter(content)
  if (!fm.hasFrontMatter) return { ok: false, error: 'SKILL.md must start with YAML front matter (--- name / description ---)' }
  if (fm.name !== name) return { ok: false, error: `Front matter name "${fm.name ?? ''}" must match the skill name "${name}"` }
  if (!fm.description || fm.description.length < 10) return { ok: false, error: 'Front matter needs a description of when to use the skill' }
  if (fm.description.length > 1024) return { ok: false, error: 'description is longer than 1024 characters' }
  return { ok: true }
}

export function userSkillPath(name: string, home = homedir()): string {
  return join(userSkillsDir(home), name, 'SKILL.md')
}

/**
 * Write a user skill atomically. Refuses to replace an existing skill unless
 * `overwrite` is set (the UI asks first).
 */
export async function saveUserSkill(
  name: unknown,
  content: unknown,
  opts: { overwrite?: boolean; home?: string } = {}
): Promise<{ ok: true; path: string; created: boolean } | { ok: false; error: string; exists?: boolean }> {
  const n = typeof name === 'string' ? name.trim() : ''
  const c = typeof content === 'string' ? content.replace(/\r\n/g, '\n') : ''
  const v = validateSkill(n, c)
  if (!v.ok) return v
  const file = userSkillPath(n, opts.home)
  const existed = existsSync(file)
  if (existed && opts.overwrite !== true) {
    return { ok: false, error: `A skill named "${n}" already exists`, exists: true }
  }
  try {
    await mkdir(join(userSkillsDir(opts.home), n), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, c.endsWith('\n') ? c : `${c}\n`, 'utf8')
    await rename(tmp, file)
    return { ok: true, path: file, created: !existed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function readUserSkill(
  name: unknown,
  home = homedir()
): Promise<{ ok: true; path: string; content: string } | { ok: false; error: string }> {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!SKILL_NAME_RE.test(n)) return { ok: false, error: 'Invalid skill name' }
  const file = userSkillPath(n, home)
  try {
    return { ok: true, path: file, content: await readFile(file, 'utf8') }
  } catch {
    return { ok: false, error: `No skill named "${n}" in ~/.agents/skills` }
  }
}
