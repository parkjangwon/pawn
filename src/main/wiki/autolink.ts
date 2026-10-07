import { readFileSync, writeFileSync } from 'fs'
import { appendLog, loadWiki, pagePath, rebuildIndex } from './pages'
import { parsePage, serializePage } from './frontmatter'
import { embedText, cosine } from '../codeIndex/embed'
import type { WikiPage, WikiScope } from './types'

const MAX_MENTION_LINKS_PER_PAGE = 6
const SEE_ALSO_THRESHOLD = 0.75

interface AutoLinkResult {
  ok: boolean
  pagesTouched: number
  linksAdded: number
  seeAlsoAdded: number
}

interface Candidate {
  title: string
  slug: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()[\]\\]/g, '\\$&')
}

function hasCjk(s: string): boolean {
  return /[\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]/.test(s)
}

function minTitleLength(title: string): number {
  return hasCjk(title) ? 2 : 4
}

/**
 * Replace code fences, inline code, and existing [[links]] with placeholder
 * tokens so the mention pass never writes inside them.
 */
function protectSpans(body: string): { text: string; restore: (s: string) => string } {
  const spans: string[] = []
  const stash = (m: string): string => {
    spans.push(m)
    return '\u0000' + (spans.length - 1) + '\u0000'
  }
  const text = body
    .replace(/```[\s\S]*?```/g, stash)
    .replace(/`[^`\n]+`/g, stash)
    .replace(/\[\[[^\]|]+(\|[^\]]*)?\]\]/g, stash)
  return {
    text,
    restore: (s: string): string =>
      s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => spans[Number(i)] ?? '')
  }
}

function mentionRegex(title: string): RegExp {
  const esc = escapeRegExp(title)
  if (hasCjk(title)) return new RegExp(esc)
  return new RegExp('(?<![A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'i')
}

function writeBody(scope: WikiScope, projectId: string | null, page: WikiPage, body: string): void {
  const raw = readFileSync(pagePath(scope, projectId, page.slug), 'utf8')
  const { fm } = parsePage(raw, page.title)
  writeFileSync(pagePath(scope, projectId, page.slug), serializePage(fm, body), 'utf8')
}

/**
 * Deterministic connector pass: insert [[links]] where a page's body mentions
 * another page's title, and give still-isolated pages one "See also" link to
 * their most similar neighbor (local hashed embedder). This is what turns a
 * pile of pages into a graph.
 */
export function autoLinkWiki(scope: WikiScope, projectId: string | null): AutoLinkResult {
  const pages = loadWiki(scope, projectId)
  if (pages.length < 2) return { ok: true, pagesTouched: 0, linksAdded: 0, seeAlsoAdded: 0 }

  const candidates: Candidate[] = pages
    .map((p) => ({ title: p.title, slug: p.slug }))
    .filter((c) => c.title.length >= minTitleLength(c.title))
    .sort((a, b) => b.title.length - a.title.length)

  let pagesTouched = 0
  let linksAdded = 0

  // Pass 1 — title mentions in body text.
  for (const page of pages) {
    const { text, restore } = protectSpans(page.body)
    let working = text
    let added = 0
    const linkedNow = new Set<string>()
    for (const c of candidates) {
      if (added >= MAX_MENTION_LINKS_PER_PAGE) break
      if (c.slug === page.slug || linkedNow.has(c.slug)) continue
      if (page.links.includes(c.slug)) continue
      const re = mentionRegex(c.title)
      const m = working.match(re)
      if (!m || m.index === undefined) continue
      working = working.slice(0, m.index) + '[[' + c.title + ']]' + working.slice(m.index + m[0].length)
      linkedNow.add(c.slug)
      added += 1
    }
    if (!added) continue
    const nextBody = restore(working)
    if (nextBody === page.body) continue
    writeBody(scope, projectId, page, nextBody)
    pagesTouched += 1
    linksAdded += added
  }

  // Pass 2 — see-also links for still-isolated pages.
  let seeAlsoAdded = 0
  const fresh = loadWiki(scope, projectId)
  const vecs = fresh.map((p) => embedText(p.title + '\n' + p.summary))
  for (let i = 0; i < fresh.length; i++) {
    const p = fresh[i]
    if (p.links.length > 0 || p.backlinks > 0) continue
    let best = -1
    let bestScore = 0
    for (let j = 0; j < fresh.length; j++) {
      if (i === j) continue
      const score = cosine(vecs[i], vecs[j])
      if (score > bestScore) {
        bestScore = score
        best = j
      }
    }
    if (best < 0 || bestScore < SEE_ALSO_THRESHOLD) continue
    const target = fresh[best]
    if (p.body.includes('[[' + target.title + ']]')) continue
    writeBody(scope, projectId, p, p.body + '\n\nSee also: [[' + target.title + ']]')
    pagesTouched += 1
    seeAlsoAdded += 1
  }

  const result: AutoLinkResult = { ok: true, pagesTouched, linksAdded, seeAlsoAdded }
  if (pagesTouched > 0) {
    rebuildIndex(scope, projectId)
    appendLog(
      scope,
      projectId,
      'autolink',
      'auto-link pass',
      linksAdded + ' links, ' + seeAlsoAdded + ' see-also'
    )
  }
  return result
}
