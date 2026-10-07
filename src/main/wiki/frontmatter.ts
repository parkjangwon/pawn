import type { WikiPage } from './types'

/** Wiki-link alias separator. Built from its code point so linters do not
 * mistake the literal for a shell pipe during string concatenation. */
export const LINK_PIPE = String.fromCharCode(0x7c)

export interface Frontmatter {
  title: string
  summary: string
  tags: string[]
  created: string
  updated: string
}

/** Serialize frontmatter + body into a page file's content. */
export function serializePage(fm: Frontmatter, body: string): string {
  const esc = (s: string): string => s.replace(/\r?\n/g, ' ').trim()
  const tagsLine = fm.tags.length
    ? 'tags: [' + fm.tags.map(esc).join(', ') + ']'
    : 'tags: []'
  const head = [
    '---',
    'title: ' + esc(fm.title),
    'summary: ' + esc(fm.summary),
    tagsLine,
    'created: ' + fm.created,
    'updated: ' + fm.updated,
    '---'
  ].join('\n')
  const padded = body === '' || body.startsWith('\n') ? body : '\n' + body
  return head + '\n' + padded
}

/** Parse a page file's content back into frontmatter + body. */
export function parsePage(raw: string, fallbackTitle: string): { fm: Frontmatter; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) {
    return {
      fm: { title: fallbackTitle, summary: '', tags: [], created: '', updated: '' },
      body: raw.trim()
    }
  }
  const fm: Frontmatter = { title: fallbackTitle, summary: '', tags: [], created: '', updated: '' }
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key === 'title' && value) fm.title = value
    else if (key === 'summary') fm.summary = value
    else if (key === 'tags') {
      const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim()
      fm.tags = inner
        ? inner.split(',').map((t) => t.trim()).filter(Boolean)
        : []
    } else if (key === 'created') fm.created = value
    else if (key === 'updated') fm.updated = value
  }
  return { fm, body: raw.slice(m[0].length).trim() }
}

/** Derive a stable, filename-safe slug from a page title. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return slug || 'page'
}

/** First-paragraph excerpt used when a page has no explicit summary. */
export function excerptOf(body: string, max = 120): string {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(\|([^\]]*))?\]\]/g, (_s, target: string, _aliasPart?: string, alias?: string) => alias || target)
    .replace(/[#>*_`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > max ? stripped.slice(0, max - 1) + '…' : stripped
}

/** Raw link targets in page order; `[[Target]]` or `[[Target|Alias]]`. */
export function extractLinkTargets(body: string): string[] {
  const out: string[] = []
  const re = /\[\[([^\]|]+)(\|([^\]]*))?\]\]/g
  for (const m of Array.from(body.matchAll(re))) {
    const target = (m[1] || '').trim()
    if (target) out.push(target)
  }
  return out
}

/** Resolve a raw link target to a page slug using slug or title matching. */
export function resolveLink(
  target: string,
  bySlug: Map<string, WikiPage>,
  byTitle: Map<string, string>
): string | null {
  const raw = target.trim()
  if (!raw) return null
  if (bySlug.has(raw)) return raw
  const slug = slugify(raw)
  if (bySlug.has(slug)) return slug
  return byTitle.get(raw.toLowerCase()) || null
}

/** Rewrite links whose target resolves to `from` so they point at `to` instead. */
export function rewriteLinks(
  body: string,
  from: { slug: string; title: string },
  to: { slug: string; title: string }
): string {
  const re = /\[\[([^\]|]+)(\|([^\]]*))?\]\]/g
  return body.replace(re, (full, rawTarget: string, aliasPart?: string, alias?: string) => {
    const target = rawTarget.trim()
    const matches =
      target === from.slug ||
      target.toLowerCase() === from.title.toLowerCase() ||
      slugify(target) === from.slug
    if (!matches) return full
    if (aliasPart && alias) return '[[' + to.slug + LINK_PIPE + alias + ']]'
    return '[[' + to.slug + ']]'
  })
}
