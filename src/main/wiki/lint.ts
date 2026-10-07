import { loadWiki, rebuildIndex } from './pages'
import { extractLinkTargets, resolveLink } from './frontmatter'
import type { WikiLintIssue, WikiPage, WikiScope } from './types'

const STALE_DAYS = 120
const OVERSIZED_CHARS = 30_000

export interface LintResult {
  ok: boolean
  issues: WikiLintIssue[]
  pages: number
}

/**
 * Deterministic health checks over one wiki: broken links, orphans, missing
 * summaries, duplicates, oversized or stale pages. Fixing content is the
 * agent's job (wiki_write); `fix: true` only rebuilds derived state (index).
 */
export function lintWiki(
  scope: WikiScope,
  projectId: string | null,
  opts: { fix?: boolean } = {}
): LintResult {
  if (opts.fix) rebuildIndex(scope, projectId)
  const pages = loadWiki(scope, projectId)

  const bySlugPage = new Map<string, WikiPage>()
  const byTitle = new Map<string, string>()
  const titleCounts = new Map<string, number>()
  for (const p of pages) {
    bySlugPage.set(p.slug, p)
    const key = p.title.toLowerCase()
    byTitle.set(key, p.slug)
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1)
  }

  const issues: WikiLintIssue[] = []

  for (const p of pages) {
    const seenBroken = new Set<string>()
    for (const target of extractLinkTargets(p.body)) {
      if (resolveLink(target, bySlugPage, byTitle)) continue
      if (seenBroken.has(target)) continue
      seenBroken.add(target)
      issues.push({ type: 'broken-link', slug: p.slug, detail: 'link target not found: [[' + target + ']]' })
    }
    if (p.links.length === 0 && p.backlinks === 0) {
      issues.push({ type: 'orphan', slug: p.slug, detail: 'no links in or out — connect it with [[wiki links]]' })
    }
    if (p.summaryFromExcerpt || !p.summary) {
      issues.push({ type: 'no-summary', slug: p.slug, detail: 'add a one-line summary for the index' })
    }
    if (p.chars < 20) {
      issues.push({ type: 'empty', slug: p.slug, detail: 'page is nearly empty (' + p.chars + ' chars)' })
    }
    if (p.chars > OVERSIZED_CHARS) {
      issues.push({ type: 'oversized', slug: p.slug, detail: p.chars + ' chars — consider splitting' })
    }
    const ageDays = (Date.now() - Date.parse(p.updated || '')) / 86_400_000
    if (Number.isFinite(ageDays) && ageDays > STALE_DAYS) {
      issues.push({ type: 'stale', slug: p.slug, detail: 'untouched for ' + Math.floor(ageDays) + ' days' })
    }
  }

  titleCounts.forEach((count, title) => {
    if (count > 1) {
      issues.push({
        type: 'duplicate-title',
        slug: byTitle.get(title) || '',
        detail: 'title "' + title + '" shared by ' + count + ' pages'
      })
    }
  })

  return { ok: issues.length === 0, issues, pages: pages.length }
}
