import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { __setWikiRootForTests, wikiDir } from '../wiki/paths'
import {
  extractLinkTargets,
  excerptOf,
  parsePage,
  rewriteLinks,
  serializePage,
  slugify,
  resolveLink,
  LINK_PIPE
} from '../wiki/frontmatter'
import {
  appendLog,
  buildGraph,
  deletePage,
  findPage,
  listPages,
  loadWiki,
  renamePage,
  tailLog,
  writePage
} from '../wiki/pages'
import { searchPages } from '../wiki/search'
import { lintWiki } from '../wiki/lint'
import { autoLinkWiki } from '../wiki/autolink'
import { buildDigest } from '../wiki/digest'
import { getWikiSettings, setWikiSettings } from '../wiki/settings'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pawn-wiki-test-'))
  __setWikiRootForTests(dir)
})

afterAll(() => {
  __setWikiRootForTests(null)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('wiki/frontmatter', () => {
  it('round-trips frontmatter and body', () => {
    const raw = serializePage(
      { title: 'React Testing', summary: 'How to test', tags: ['react', 'vitest'], created: 'c1', updated: 'u1' },
      'Use [[Vitest Basics]] first.'
    )
    const { fm, body } = parsePage(raw, 'fallback')
    expect(fm.title).toBe('React Testing')
    expect(fm.summary).toBe('How to test')
    expect(fm.tags).toEqual(['react', 'vitest'])
    expect(fm.created).toBe('c1')
    expect(fm.updated).toBe('u1')
    expect(body).toBe('Use [[Vitest Basics]] first.')
  })

  it('slugifies titles', () => {
    expect(slugify('React Testing Gotchas!')).toBe('react-testing-gotchas')
    expect(slugify('한글 제목 테스트')).not.toBe('')
    expect(slugify('')).toBe('page')
  })

  it('extracts and resolves link targets', () => {
    const targets = extractLinkTargets('see [[A B]] and [[a-b|the basics]] end')
    expect(targets).toEqual(['A B', 'a-b'])
    const page = {
      slug: 'a-b',
      title: 'A B',
      summary: '',
      tags: [],
      created: '',
      updated: '',
      links: [],
      backlinks: 0,
      chars: 0,
      body: ''
    }
    const bySlug = new Map([[page.slug, page]])
    const byTitle = new Map([['a b', 'a-b']])
    expect(resolveLink('A B', bySlug, byTitle)).toBe('a-b')
    expect(resolveLink('a-b', bySlug, byTitle)).toBe('a-b')
    expect(resolveLink('missing', bySlug, byTitle)).toBeNull()
  })

  it('rewrites links including aliases', () => {
    const out = rewriteLinks('x [[Old]] y [[Old|alias]] z [[Other]]', { slug: 'old', title: 'Old' }, { slug: 'new', title: 'New' })
    expect(out).toBe('x [[new]] y [[new' + LINK_PIPE + 'alias]] z [[Other]]')
  })

  it('builds excerpts without markup', () => {
    expect(excerptOf('# Heading\nsome [[Link|named]] text', 60)).toContain('named')
    expect(excerptOf('x'.repeat(200), 10)).toHaveLength(10)
  })
})

describe('wiki/pages', () => {
  it('creates, updates and finds pages by slug or title', () => {
    const created = writePage({ title: 'React Testing', body: 'first pass', scope: 'project', projectId: 'p1' })
    expect(created.ok).toBe(true)
    expect(created.created).toBe(true)

    const updated = writePage({ title: 'React Testing', body: 'second pass', summary: 'sum', scope: 'project', projectId: 'p1' })
    expect(updated.ok).toBe(true)
    expect(updated.created).toBe(false)

    expect(findPage('project', 'p1', 'react-testing')?.body).toBe('second pass')
    expect(findPage('project', 'p1', 'React Testing')?.summary).toBe('sum')
    expect(findPage('project', 'other-project', 'react-testing')).toBeNull()
  })

  it('maintains index.md, log.md and the link graph', () => {
    writePage({ title: 'Alpha', body: 'links to [[Beta Page]]', scope: 'user', projectId: null })
    writePage({ title: 'Beta Page', body: 'standalone', scope: 'user', projectId: null })

    const indexRaw = readFileSync(join(wikiDir('user', null), 'index.md'), 'utf8')
    expect(indexRaw).toContain('[[alpha')
    expect(indexRaw).toContain('Beta Page')

    const pages = loadWiki('user', null)
    const alpha = pages.find((p) => p.slug === 'alpha')
    const beta = pages.find((p) => p.slug === 'beta-page')
    expect(alpha?.links).toEqual(['beta-page'])
    expect(beta?.backlinks).toBe(1)

    const graph = buildGraph('user', null)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toEqual([{ source: 'alpha', target: 'beta-page' }])

    const log = tailLog('user', null, 10)
    expect(log.length).toBe(2)
    expect(log[0].op).toBe('create')
    expect(log[0].title).toBe('Beta Page')
  })

  it('renames pages and rewrites inbound links', () => {
    writePage({ title: 'Old Name', body: 'content', scope: 'user', projectId: null })
    writePage({ title: 'Referrer', body: 'see [[Old Name]] today', scope: 'user', projectId: null })
    const res = renamePage('user', null, 'old-name', 'New Name')
    expect(res.ok).toBe(true)
    expect(res.rewritten).toBe(2)

    expect(findPage('user', null, 'old-name')).toBeNull()
    const referrer = findPage('user', null, 'referrer')
    expect(referrer?.body).toContain('[[new-name]]')
    expect(existsSync(join(wikiDir('user', null), 'pages', 'new-name.md'))).toBe(true)
  })

  it('deletes pages and lists with filters', () => {
    writePage({ title: 'Keep', body: 'keeper', scope: 'user', projectId: null })
    writePage({ title: 'Drop', body: 'droppable', scope: 'user', projectId: null })
    expect(deletePage('user', null, 'drop').ok).toBe(true)
    expect(deletePage('user', null, 'drop').ok).toBe(false)

    const { items, total } = listPages('user', null, { query: 'keeper' })
    expect(total).toBe(1)
    expect(items[0].slug).toBe('keep')
  })

  it('appends and parses log entries', () => {
    appendLog('user', null, 'create', 'T', 't-slug')
    const entries = tailLog('user', null, 5)
    expect(entries).toHaveLength(1)
    expect(entries[0].op).toBe('create')
    expect(entries[0].detail).toBe('t-slug')
  })
})

describe('wiki/search', () => {
  it('ranks across scopes with snippets', () => {
    writePage({ title: 'Deploy Guide', body: 'run npm run deploy to ship the app', summary: 'shipping steps', tags: ['deploy'], scope: 'project', projectId: 'p1' })
    writePage({ title: 'Global Note', body: 'deploy prefers the staging channel', scope: 'user', projectId: null })

    const hits = searchPages({ query: 'deploy', projectId: 'p1' })
    expect(hits.length).toBe(2)
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score)
    expect(hits.some((h) => h.scope === 'project')).toBe(true)
    expect(hits.every((h) => h.snippet.length > 0)).toBe(true)

    expect(searchPages({ query: 'deploy', scope: 'user', projectId: 'p1' })).toHaveLength(1)
    expect(searchPages({ query: '', projectId: 'p1' })).toHaveLength(0)
  })
})

describe('wiki/lint', () => {
  it('reports broken links, orphans and missing summaries', () => {
    writePage({ title: 'Hub', body: 'points at [[Missing Page]] and [[Leaf]]', scope: 'user', projectId: null })
    writePage({ title: 'Leaf', body: 'a leaf page with enough content in it', scope: 'user', projectId: null })
    writePage({ title: 'Island', body: 'a lonely page nobody links to or from', scope: 'user', projectId: null })

    const res = lintWiki('user', null)
    expect(res.pages).toBe(3)
    const types = res.issues.map((i) => i.type)
    expect(types).toContain('broken-link')
    expect(types).toContain('orphan')
    expect(types).toContain('no-summary')
    expect(res.issues.find((i) => i.type === 'orphan')?.slug).toBe('island')
  })

  it('passes clean on a well-linked wiki', () => {
    writePage({ title: 'One', body: 'a first page; see [[Two]] for the rest', summary: 'first', scope: 'user', projectId: null })
    writePage({ title: 'Two', body: 'a second page; see [[One]] for the start', summary: 'second', scope: 'user', projectId: null })
    const res = lintWiki('user', null)
    expect(res.ok).toBe(true)
  })
})

describe('wiki/autolink', () => {
  it('links pages whose body mentions another page title', () => {
    writePage({ title: 'Deploy Runbook', body: 'how to ship', summary: 'deploy steps', scope: 'user', projectId: null })
    writePage({ title: 'Staging Channel', body: 'read the Deploy Runbook before shipping', summary: 'where we ship', scope: 'user', projectId: null })

    const res = autoLinkWiki('user', null)
    expect(res.linksAdded).toBe(1)
    const stg = findPage('user', null, 'staging-channel')
    expect(stg?.body).toContain('[[Deploy Runbook]]')
    expect(stg?.links).toContain('deploy-runbook')
    expect(findPage('user', null, 'deploy-runbook')?.backlinks).toBe(1)

    // Idempotent: existing [[links]] are protected, nothing new added.
    const again = autoLinkWiki('user', null)
    expect(again.linksAdded).toBe(0)
  })

  it('never writes inside code spans and respects caps', () => {
    writePage({ title: 'Snippet Page', body: 'use `Snippet Target` inside code', summary: 'code demo', scope: 'user', projectId: null })
    writePage({ title: 'Snippet Target', body: 'the target page', summary: 'target', scope: 'user', projectId: null })
    const res = autoLinkWiki('user', null)
    expect(res.linksAdded).toBe(0)
    expect(findPage('user', null, 'snippet-page')?.body).toContain('`Snippet Target`')
  })

  it('gives isolated similar pages a See also link', () => {
    const shared = 'the galaxy z fold 7 battery life review details'
    writePage({ title: 'Fold Review Alpha', body: shared, summary: shared, scope: 'user', projectId: null })
    writePage({ title: 'Fold Review Beta', body: shared, summary: shared, scope: 'user', projectId: null })

    const res = autoLinkWiki('user', null)
    // Both pages are isolated, so each gets a See also to the other.
    expect(res.seeAlsoAdded).toBe(2)
    const alpha = findPage('user', null, 'fold-review-alpha')
    expect(alpha?.body).toContain('See also: [[')
  })
})

describe('wiki/secret guard', () => {
  it('masks secrets on write and rejects near-pure secret dumps', () => {
    writePage({
      title: 'API Setup',
      body: 'request with the header "Authorization: Bearer abc123def456ghi789jklm" against the staging host.',
      summary: 'how to call the API',
      scope: 'user',
      projectId: null
    })
    const page = findPage('user', null, 'api-setup')
    expect(page?.body).toContain('[REDACTED:generic_bearer]')
    expect(page?.body).not.toContain('abc123def456ghi789jklm')

    const rejected = writePage({
      title: 'Leak',
      body: 'password=hunter2secret123 api_key=sk-abcdefghijklmnopqrstuvwx',
      scope: 'user',
      projectId: null
    })
    expect(rejected.ok).toBe(false)
  })
})

describe('wiki/digest + settings', () => {
  it('returns empty digest for an empty wiki and a populated one otherwise', () => {
    expect(buildDigest({ projectId: 'p1' })).toBe('')
    writePage({ title: 'Fact', body: 'the deploy target is staging', summary: 'deploy target', scope: 'project', projectId: 'p1' })
    const digest = buildDigest({ projectId: 'p1' })
    expect(digest).toContain('untrusted data')
    expect(digest).toContain('Fact') // index line
    expect(digest).toContain('deploy target')
    expect(digest).toContain('wiki_write')
  })

  it('stores and clamps settings', () => {
    const next = setWikiSettings({ injectMaxChars: 9_999_999, logTail: 99 })
    expect(next.injectMaxChars).toBe(20_000)
    expect(next.logTail).toBe(20)
    expect(getWikiSettings().enabled).toBe(true)
  })
})
