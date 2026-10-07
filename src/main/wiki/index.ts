/**
 * Pawn LLM-Wiki — an interlinked markdown knowledge base under ~/.pawn/wiki
 * that the agent maintains itself: pages with [[wiki links]], a derived
 * index.md catalog, an append-only log.md, and a link graph.
 */
export {
  getWikiSettings,
  setWikiSettings
} from './settings'
export {
  loadWiki,
  findPage,
  writePage,
  deletePage,
  renamePage,
  listPages,
  rebuildIndex,
  buildGraph,
  tailLog
} from './pages'
export { searchPages } from './search'
export { lintWiki, type LintResult } from './lint'
export { autoLinkWiki } from './autolink'
export { buildDigest } from './digest'
export { __setWikiRootForTests, wikiRoot, wikiDir } from './paths'
export { DEFAULT_WIKI_SETTINGS } from './types'
export type {
  WikiGraph,
  WikiLintIssue,
  WikiLogEntry,
  WikiPage,
  WikiPageMeta,
  WikiScope,
  WikiSearchHit,
  WikiSettings,
  WikiWriteInput
} from './types'
