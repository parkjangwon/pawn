/** LLM-Wiki — an interlinked markdown knowledge base the agent maintains itself. */

export type WikiScope = 'user' | 'project'

export interface WikiPageMeta {
  /** Filename stem, e.g. `react-testing-gotchas`. Stable identity of the page. */
  slug: string
  title: string
  /** Frontmatter summary, or a first-paragraph excerpt when missing. */
  summary: string
  tags: string[]
  created: string
  updated: string
  /** Outgoing link targets resolved to slugs (unresolved targets omitted). */
  links: string[]
  /** Resolved incoming link count across the same wiki (index.md excluded). */
  backlinks: number
  chars: number
}

export interface WikiPage extends WikiPageMeta {
  body: string
  /** True when summary came from an auto-excerpt, not an explicit frontmatter line. */
  summaryFromExcerpt?: boolean
}

export interface WikiWriteInput {
  title: string
  body: string
  summary?: string
  tags?: string[]
  scope: WikiScope
  projectId: string | null
}

export interface WikiSearchHit extends WikiPageMeta {
  scope: WikiScope
  score: number
  snippet: string
}

export interface WikiLintIssue {
  type: 'broken-link' | 'orphan' | 'no-summary' | 'empty' | 'duplicate-title' | 'oversized' | 'stale'
  slug: string
  detail: string
}

export interface WikiGraph {
  nodes: Array<{ id: string; title: string; degree: number; tags: string[]; updated: string }>
  edges: Array<{ source: string; target: string }>
}

export interface WikiLogEntry {
  at: string
  op: string
  title: string
  detail: string
}

export interface WikiSettings {
  /** Master switch — tools + injection */
  enabled: boolean
  /** Inject the wiki index digest into the turn preamble */
  injectIndex: boolean
  /** Max chars for the injected digest */
  injectMaxChars: number
  /** Recent log entries included in the digest */
  logTail: number
}

export const DEFAULT_WIKI_SETTINGS: WikiSettings = {
  enabled: true,
  injectIndex: true,
  injectMaxChars: 4000,
  logTail: 5
}
