import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { indexPath, logPath, pagesDir } from './paths'
import { validateWikiWrite } from './safety'
import {
  LINK_PIPE,
  excerptOf,
  extractLinkTargets,
  parsePage,
  resolveLink,
  rewriteLinks,
  serializePage,
  slugify
} from './frontmatter'
import type { WikiGraph, WikiLogEntry, WikiPage, WikiPageMeta, WikiScope, WikiWriteInput } from './types'

const MAX_BODY_CHARS = 200_000
const MAX_TITLE_CHARS = 200

function nowIso(): string {
  return new Date().toISOString()
}

function safeSlugName(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9\u00c0-\uffff._-]/g, '_').replace(/^\.+/, '')
}

export function pagePath(scope: WikiScope, projectId: string | null, slug: string): string {
  return join(pagesDir(scope, projectId), safeSlugName(slug) + '.md')
}

/** Load every page of one wiki, freshest first. */
export function loadWiki(scope: WikiScope, projectId: string | null): WikiPage[] {
  const dir = pagesDir(scope, projectId)
  if (!existsSync(dir)) return []
  const pages: WikiPage[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const stem = name.slice(0, -3)
    let raw = ''
    try {
      raw = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    const { fm, body } = parsePage(raw, stem)
    pages.push({
      slug: stem,
      title: fm.title || stem,
      summary: fm.summary || excerptOf(body),
      summaryFromExcerpt: !fm.summary,
      tags: fm.tags,
      created: fm.created,
      updated: fm.updated,
      links: [],
      backlinks: 0,
      chars: body.length,
      body
    })
  }
  resolveLinkGraph(pages)
  pages.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
  return pages
}

/** Fill in each page's resolved outgoing links and incoming counts, in place. */
export function resolveLinkGraph(pages: WikiPage[]): void {
  const bySlug = new Map<string, WikiPage>()
  const byTitle = new Map<string, string>()
  for (const p of pages) {
    bySlug.set(p.slug, p)
    byTitle.set(p.title.toLowerCase(), p.slug)
  }
  for (const p of pages) p.backlinks = 0
  for (const p of pages) {
    const resolved = new Set<string>()
    for (const target of extractLinkTargets(p.body)) {
      const slug = resolveLink(target, bySlug, byTitle)
      if (slug && slug !== p.slug) resolved.add(slug)
    }
    p.links = Array.from(resolved)
    resolved.forEach((slug) => {
      const target = bySlug.get(slug)
      if (target) target.backlinks += 1
    })
  }
}

function metaOf(p: WikiPage): WikiPageMeta {
  const { body: _body, ...meta } = p
  return meta
}

export function findPage(
  scope: WikiScope,
  projectId: string | null,
  ref: string
): WikiPage | null {
  const pages = loadWiki(scope, projectId)
  const lower = ref.trim().toLowerCase()
  return (
    pages.find((p) => p.slug === ref) ||
    pages.find((p) => p.slug === slugify(ref)) ||
    pages.find((p) => p.title.toLowerCase() === lower) ||
    null
  )
}

/** Create or update a page. Identity is the slugified title. */
export function writePage(input: WikiWriteInput): {
  ok: boolean
  page?: WikiPageMeta
  created?: boolean
  error?: string
} {
  const rawTitle = String(input.title || '').trim()
  const rawBody = String(input.body || '')
  if (!rawTitle) return { ok: false, error: 'title is required' }
  if (rawTitle.length > MAX_TITLE_CHARS) return { ok: false, error: 'title too long' }
  if (rawBody.length > MAX_BODY_CHARS) return { ok: false, error: 'body too long (split the page)' }

  const rawSummary = (input.summary || '').trim()
  // Secrets are masked, never persisted; near-pure secret writes are rejected.
  const check = validateWikiWrite(rawTitle, rawSummary, rawBody)
  if (check.mostlySecrets) {
    return { ok: false, error: 'write rejected: content is mostly secrets (passwords, API keys, tokens are never stored)' }
  }
  const title = check.title
  const body = check.body

  const slug = slugify(title)
  const existing = findPage(input.scope, input.projectId, slug)
  const now = nowIso()
  // Only explicit summaries are persisted; excerpts stay derived (read-time).
  const summary = check.summary || (existing && !existing.summaryFromExcerpt ? existing.summary : '')
  const tags = (input.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 24)
  const targetSlug = existing ? existing.slug : slug

  const content = serializePage(
    {
      title,
      summary,
      tags,
      created: existing?.created || now,
      updated: now
    },
    body
  )
  writeFileSync(pagePath(input.scope, input.projectId, targetSlug), content, 'utf8')
  rebuildIndex(input.scope, input.projectId)
  appendLog(input.scope, input.projectId, existing ? 'update' : 'create', title, targetSlug)

  const saved = findPage(input.scope, input.projectId, targetSlug)
  return { ok: true, page: saved ? metaOf(saved) : undefined, created: !existing }
}

export function deletePage(
  scope: WikiScope,
  projectId: string | null,
  slug: string
): { ok: boolean; error?: string } {
  const page = findPage(scope, projectId, slug)
  if (!page) return { ok: false, error: 'page not found' }
  rmSync(pagePath(scope, projectId, page.slug), { force: true })
  rebuildIndex(scope, projectId)
  appendLog(scope, projectId, 'delete', page.title, page.slug)
  return { ok: true }
}

/** Rename a page and rewrite every `[[link]]` that pointed at it. */
export function renamePage(
  scope: WikiScope,
  projectId: string | null,
  fromRef: string,
  toTitle: string
): { ok: boolean; page?: WikiPageMeta; rewritten?: number; error?: string } {
  const page = findPage(scope, projectId, fromRef)
  const title = String(toTitle || '').trim()
  if (!page) return { ok: false, error: 'page not found' }
  if (!title) return { ok: false, error: 'new title is required' }
  const newSlug = slugify(title)
  if (newSlug !== page.slug) {
    const clash = findPage(scope, projectId, newSlug)
    if (clash && clash.slug !== page.slug) {
      return { ok: false, error: 'a page with that title already exists: ' + clash.slug }
    }
  }

  const from = { slug: page.slug, title: page.title }
  const to = { slug: newSlug, title }
  let rewritten = 0
  for (const p of loadWiki(scope, projectId)) {
    const isRenamed = p.slug === page.slug
    const nextBody = rewriteLinks(p.body, from, to)
    if (nextBody === p.body && !isRenamed) continue
    const { fm } = parsePage(readFileSync(pagePath(scope, projectId, p.slug), 'utf8'), p.title)
    const content = serializePage({ ...fm, title: isRenamed ? to.title : fm.title }, nextBody)
    const target = isRenamed ? newSlug : p.slug
    writeFileSync(pagePath(scope, projectId, target), content, 'utf8')
    if (isRenamed && newSlug !== page.slug) {
      rmSync(pagePath(scope, projectId, page.slug), { force: true })
    }
    rewritten += 1
  }
  rebuildIndex(scope, projectId)
  appendLog(scope, projectId, 'rename', title, from.slug + ' -> ' + to.slug)
  const saved = findPage(scope, projectId, newSlug)
  return { ok: true, page: saved ? metaOf(saved) : undefined, rewritten }
}

export function listPages(
  scope: WikiScope,
  projectId: string | null,
  opts: { query?: string; limit?: number; offset?: number } = {}
): { items: WikiPageMeta[]; total: number } {
  const pages = loadWiki(scope, projectId)
  const q = (opts.query || '').trim().toLowerCase()
  const filtered = q
    ? pages.filter((p) =>
        (p.title + ' ' + p.summary + ' ' + p.tags.join(' ') + ' ' + p.body).toLowerCase().includes(q)
      )
    : pages
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  return { items: filtered.slice(offset, offset + limit).map(metaOf), total: filtered.length }
}

/** Derive log entries from the append-only log file, newest first. */
export function tailLog(scope: WikiScope, projectId: string | null, limit = 20): WikiLogEntry[] {
  const file = logPath(scope, projectId)
  if (!existsSync(file)) return []
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const entries: WikiLogEntry[] = []
  for (const line of raw.split('\n')) {
    const m = line.match(/^## \[([^\]]+)\] ([a-z]+) \| (.*)$/)
    if (!m) continue
    const rest = m[3] || ''
    const sep = rest.indexOf(' (')
    const title = sep >= 0 ? rest.slice(0, sep) : rest
    const detail =
      sep >= 0 && rest.endsWith(')') ? rest.slice(sep + 2, rest.length - 1) : sep >= 0 ? rest.slice(sep + 2) : ''
    entries.push({ at: m[1], op: m[2], title, detail })
  }
  return entries.slice(-limit).reverse()
}

export function appendLog(
  scope: WikiScope,
  projectId: string | null,
  op: string,
  title: string,
  detail: string
): void {
  const line = '## [' + nowIso() + '] ' + op + ' | ' + title + (detail ? ' (' + detail + ')' : '')
  try {
    appendFileSync(logPath(scope, projectId), line + '\n', 'utf8')
  } catch {
    /* log is best-effort */
  }
}

/** Regenerate index.md from the current pages. Always truth. */
export function rebuildIndex(scope: WikiScope, projectId: string | null): void {
  const pages = loadWiki(scope, projectId)
  const lines = [
    '---',
    'title: Wiki Index',
    'summary: Auto-generated catalog of every wiki page.',
    'updated: ' + nowIso(),
    '---',
    '',
    '# Wiki Index',
    ''
  ]
  for (const p of pages) {
    const date = (p.updated || '').slice(0, 10)
    const summary = p.summary || excerptOf(p.body, 100)
    lines.push('- [[' + p.slug + LINK_PIPE + p.title + ']] — ' + summary + (date ? ' · ' + date : ''))
  }
  lines.push('')
  try {
    writeFileSync(indexPath(scope, projectId), lines.join('\n'), 'utf8')
  } catch {
    /* best-effort */
  }
}

export function buildGraph(scope: WikiScope, projectId: string | null): WikiGraph {
  const pages = loadWiki(scope, projectId)
  const edges: Array<{ source: string; target: string }> = []
  const seen = new Set<string>()
  for (const p of pages) {
    for (const target of p.links) {
      const key = p.slug < target ? p.slug + '->' + target : target + '->' + p.slug
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: p.slug, target })
    }
  }
  return {
    nodes: pages.map((p) => ({
      id: p.slug,
      title: p.title,
      degree: p.links.length + p.backlinks,
      tags: p.tags,
      updated: p.updated
    })),
    edges
  }
}
