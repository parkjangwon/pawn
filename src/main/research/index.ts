/**
 * Built-in public-web research engine.
 *
 * Port of the adaptive Phase 0→3 public reader from insane-search
 * (https://github.com/fivetaku/insane-search, MIT License, © 2026 fivetaku).
 *
 * Boundaries: public content only — not a login/paywall bypass.
 * Browser automation remains separate (browser_* tools); this engine may
 * advise mustInvokeBrowser when the HTTP grid is exhausted.
 */
export { fetchUrl, formatFetchForAgent } from './fetchChain'
export { researchTopic, formatResearchForAgent } from './research'
export { webSearch } from './search'
export { phase0Route, phase0Platform } from './phase0'
export { classifyUrl } from './safety'
export { wrapUntrustedContent, analyzeUntrustedContent } from './contentSafety'
export type { FetchResult, FetchOptions, Attempt, Verdict } from './types'
export type { ResearchOptions, ResearchResult, ResearchSource } from './research'
export type { SearchHit, WebSearchResult } from './search'
