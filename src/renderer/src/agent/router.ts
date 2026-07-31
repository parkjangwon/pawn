/**
 * Cache-aware model router.
 *
 * Two goals pull against each other:
 *   1. Use the cheapest model that can do the job (the "auto mode" ask).
 *   2. Keep prompt-cache hits high (the "don't waste tokens" ask).
 *
 * They conflict because every provider caches independently. Switching models
 * mid-conversation throws away a warm prefix and pays a cache *write* (1.25x on
 * Anthropic) to re-prime the new one. On a long session that re-prime routinely
 * costs more than the per-token savings of the cheaper model.
 *
 * So the policy is: pick the tier at the start of each user turn, then stay on
 * that model for the whole turn. Escalate freely when the work turns out to be
 * harder than the heuristic guessed; downgrade only between user turns, and only
 * when the projected savings beat the measured cost of re-priming the prefix.
 */

import { useProviderStore } from '../stores/provider'
import type { ModelEntry, ModelTier, Provider } from '../types/provider'
import { estimateTokens, type TranscriptEntry } from './transcript'

export type Complexity = 'simple' | 'medium' | 'complex'

const TIER_OF: Record<Complexity, ModelTier> = { simple: 'low', medium: 'mid', complex: 'high' }
const TIER_ORDER: ModelTier[] = ['low', 'mid', 'high']

export interface RouteTarget {
  provider: Provider
  model: ModelEntry
}

export interface RouteDecision extends RouteTarget {
  /** `providerId:modelId` — the cache identity. Same key ⇒ same warm prefix. */
  key: string
  tier: ModelTier
  reason: string
}

export function routeKey(model: ModelEntry): string {
  return `${model.providerId}:${model.modelId}`
}

// --- Provider health --------------------------------------------------------
// A provider that just returned 429/5xx is put on a short cooldown so the router
// fails over instead of burning the retry budget on a dead endpoint.

interface Health {
  failures: number
  cooldownUntil: number
}

const health = new Map<string, Health>()

export function noteProviderFailure(providerId: string): void {
  const h = health.get(providerId) || { failures: 0, cooldownUntil: 0 }
  h.failures++
  // 5s, 15s, 45s, capped at 2min.
  h.cooldownUntil = Date.now() + Math.min(120_000, 5000 * Math.pow(3, Math.min(h.failures - 1, 3)))
  health.set(providerId, h)
}

export function noteProviderSuccess(providerId: string): void {
  health.delete(providerId)
}

export function isProviderAvailable(providerId: string): boolean {
  const h = health.get(providerId)
  return !h || h.cooldownUntil <= Date.now()
}

export function providerCooldownRemaining(providerId: string): number {
  const h = health.get(providerId)
  return h ? Math.max(0, h.cooldownUntil - Date.now()) : 0
}

// --- Session stickiness -----------------------------------------------------

interface SessionRoute {
  key: string
  tier: ModelTier
  /** Tokens already written into this model's cache for this session. */
  warmTokens: number
}

const sessionRoutes = new Map<string, SessionRoute>()

export function getSessionRoute(sessionId: string): SessionRoute | undefined {
  return sessionRoutes.get(sessionId)
}

export function setSessionRoute(sessionId: string, key: string, tier: ModelTier, warmTokens: number): void {
  sessionRoutes.set(sessionId, { key, tier, warmTokens })
}

export function clearSessionRoute(sessionId: string): void {
  sessionRoutes.delete(sessionId)
}

// --- Complexity heuristic ---------------------------------------------------

/**
 * Cheap, local classification of how hard the next turn is likely to be. It only
 * has to be right often enough that escalation covers the rest — a wrong guess
 * costs one extra round, not a wrong answer.
 */
export function estimateComplexity(message: string): Complexity {
  const text = message.trim()
  if (!text) return 'simple'

  // Inline @file / <file> context blocks inflate length without adding difficulty.
  const withoutBlocks = text.replace(/<file[\s\S]*?<\/file>/g, '').replace(/<skill[\s\S]*?<\/skill>/g, '')
  const len = withoutBlocks.length

  let score = 0
  if (len > 400) score += 2
  else if (len > 160) score += 1

  if (/```/.test(withoutBlocks)) score++
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|rb|c|cpp|css|html|json|ya?ml|sql)\b/i.test(withoutBlocks)) score++
  if (/\b(then|after that|step\s*\d)\b/i.test(withoutBlocks)) score++
  // Korean has no ASCII word boundaries, so CJK keywords must match as plain
  // substrings rather than inside a \b group (which silently never fires).
  if (/먼저|그리고 나서|다음에/.test(withoutBlocks)) score++
  if (/\b(refactor|architect|migrate|debug|investigate|optimi[sz]e|design)\b/i.test(withoutBlocks)) score += 2
  if (/리팩토링|설계|분석|디버깅|최적화/.test(withoutBlocks)) score += 2
  if (/\b(across|codebase|all files|every|entire)\b/i.test(withoutBlocks)) score++
  if (/전체|모든/.test(withoutBlocks)) score++

  // Strong "this is trivial" signals win outright — greetings, yes/no, restatements.
  if (len < 40 && !/```/.test(withoutBlocks) && score <= 1) return 'simple'

  if (score >= 4) return 'complex'
  if (score >= 1) return 'medium'
  return 'simple'
}

// --- Cost model -------------------------------------------------------------

/**
 * Expected USD cost of one round on this model, assuming `warmRatio` of the
 * input prefix is served from cache. Models with no pricing configured get a
 * neutral score so they are ordered by tier alone rather than being treated as free.
 */
export function estimateRoundCost(
  model: ModelEntry,
  promptTokens: number,
  outputTokens: number,
  warmRatio: number
): number | null {
  const p = model.pricing
  if (!p) return null
  const cached = promptTokens * warmRatio
  const fresh = promptTokens - cached
  return (cached * p.cacheRead + fresh * p.input + outputTokens * p.output) / 1_000_000
}

/** One-time cost of moving a session's warm prefix onto a different model. */
export function estimateRePrimeCost(model: ModelEntry, promptTokens: number): number | null {
  const p = model.pricing
  if (!p) return null
  return (promptTokens * p.cacheWrite) / 1_000_000
}

// --- Candidate selection ----------------------------------------------------

function candidates(): RouteTarget[] {
  const { providers, models } = useProviderStore.getState()
  const byId = new Map(providers.filter((p) => p.enabled).map((p) => [p.id, p]))
  const out: RouteTarget[] = []
  for (const model of models) {
    if (!model.enabled) continue
    const provider = byId.get(model.providerId)
    if (!provider) continue
    if (model.supportsTools === false) continue
    out.push({ provider, model })
  }
  return out
}

/** Rank same-tier candidates: healthy first, then cheapest, then stable by id. */
function rank(list: RouteTarget[], promptTokens: number, warmKey: string | null): RouteTarget[] {
  return list.slice().sort((a, b) => {
    const aUp = isProviderAvailable(a.provider.id) ? 0 : 1
    const bUp = isProviderAvailable(b.provider.id) ? 0 : 1
    if (aUp !== bUp) return aUp - bUp

    // A model whose cache is already warm for this session gets its input priced
    // at the cache-read rate; everything else pays full freight.
    const aCost = estimateRoundCost(a.model, promptTokens, 1000, routeKey(a.model) === warmKey ? 0.9 : 0)
    const bCost = estimateRoundCost(b.model, promptTokens, 1000, routeKey(b.model) === warmKey ? 0.9 : 0)
    if (aCost !== null && bCost !== null && aCost !== bCost) return aCost - bCost
    if (aCost === null && bCost !== null) return 1
    if (aCost !== null && bCost === null) return -1

    return a.model.id.localeCompare(b.model.id)
  })
}

export interface RouteRequest {
  sessionId: string
  /** Transcript as it will be sent, used for prompt-size and re-prime maths. */
  entries: TranscriptEntry[]
  complexity: Complexity
  /** Bump the tier by this many steps (escalation after failures / deep tool loops). */
  escalate?: number
  /** Model keys to skip — already failed this turn. */
  exclude?: Set<string>
  /** True on the first round of a user turn, when a downgrade may be considered. */
  newTurn?: boolean
}

/**
 * Resolve the model for the next request. Returns null only when nothing is
 * configured at all; every other failure mode degrades to an adjacent tier or a
 * different provider rather than giving up.
 */
export function route(req: RouteRequest): RouteDecision | null {
  const { routingMode, activeModelId } = useProviderStore.getState()
  const all = candidates()
  if (all.length === 0) return null

  const exclude = req.exclude || new Set<string>()
  const usable = all.filter((c) => !exclude.has(routeKey(c.model)))
  const pool = usable.length > 0 ? usable : all
  const promptTokens = estimateTokens(req.entries)
  const sticky = sessionRoutes.get(req.sessionId)

  // --- Manual: the user pinned a model. Honour it unless it is unusable. -----
  if (routingMode === 'manual' && activeModelId) {
    const pinned = pool.find((c) => c.model.id === activeModelId)
    if (pinned) {
      return { ...pinned, key: routeKey(pinned.model), tier: pinned.model.tier, reason: 'manual pin' }
    }
    const anyPinned = all.find((c) => c.model.id === activeModelId)
    if (anyPinned && exclude.has(routeKey(anyPinned.model))) {
      // Pinned model failed this turn — fall through to auto so the turn survives.
    } else if (anyPinned) {
      return { ...anyPinned, key: routeKey(anyPinned.model), tier: anyPinned.model.tier, reason: 'manual pin' }
    }
  }

  // --- Auto: tier from complexity, adjusted for stickiness and escalation ----
  let targetIdx = TIER_ORDER.indexOf(TIER_OF[req.complexity])
  let reason = `auto: ${req.complexity}`

  if (sticky && !exclude.has(sticky.key)) {
    const stickyIdx = TIER_ORDER.indexOf(sticky.tier)
    if (stickyIdx > targetIdx) {
      // The session is already on a stronger model with a warm prefix. Only step
      // down if the remaining conversation is long enough for the savings to
      // repay the re-prime, and only at a user-turn boundary.
      const current = pool.find((c) => routeKey(c.model) === sticky.key)
      const target = rank(pool.filter((c) => c.model.tier === TIER_ORDER[targetIdx]), promptTokens, sticky.key)[0]
      const worthIt = req.newTurn === true && current && target && isDowngradeWorthIt(current.model, target.model, promptTokens)
      if (!worthIt) {
        targetIdx = stickyIdx
        reason = current ? 'sticky: keeping warm cache' : reason
      } else {
        reason = `auto: ${req.complexity} (downgrade pays for re-prime)`
      }
    }
  }

  if (req.escalate && req.escalate > 0) {
    targetIdx = Math.min(TIER_ORDER.length - 1, targetIdx + req.escalate)
    reason = `escalated to ${TIER_ORDER[targetIdx]}`
  }

  // Walk outward from the target tier: exact match, then up, then down. Upward
  // first because an over-powered model still produces a correct answer while an
  // under-powered one may loop.
  const order: ModelTier[] = [TIER_ORDER[targetIdx]]
  for (let d = 1; d < TIER_ORDER.length; d++) {
    if (targetIdx + d < TIER_ORDER.length) order.push(TIER_ORDER[targetIdx + d])
    if (targetIdx - d >= 0) order.push(TIER_ORDER[targetIdx - d])
  }

  const warmKey = sticky && !exclude.has(sticky.key) ? sticky.key : null
  for (const tier of order) {
    const tierPool = rank(pool.filter((c) => c.model.tier === tier), promptTokens, warmKey)
    const healthy = tierPool.find((c) => isProviderAvailable(c.provider.id))
    const pick = healthy || tierPool[0]
    if (!pick) continue
    const key = routeKey(pick.model)
    const note = tier === TIER_ORDER[targetIdx] ? reason : `${reason} → fell back to ${tier}`
    return { ...pick, key, tier, reason: healthy ? note : `${note} (all providers cooling down)` }
  }

  const last = rank(pool, promptTokens, warmKey)[0]
  return last ? { ...last, key: routeKey(last.model), tier: last.model.tier, reason: 'only model available' } : null
}

/**
 * A downgrade is only worth it if the cheaper model saves more over the expected
 * remaining rounds than the one-off cache write costs. Without this check auto
 * mode oscillates between tiers and pays a re-prime on every oscillation — which
 * is exactly how naive "auto" routing ends up more expensive than a fixed model.
 */
function isDowngradeWorthIt(from: ModelEntry, to: ModelEntry, promptTokens: number): boolean {
  const EXPECTED_REMAINING_ROUNDS = 6
  const OUTPUT_PER_ROUND = 800

  const rePrime = estimateRePrimeCost(to, promptTokens)
  const stayCost = estimateRoundCost(from, promptTokens, OUTPUT_PER_ROUND, 0.9)
  const moveCost = estimateRoundCost(to, promptTokens, OUTPUT_PER_ROUND, 0.9)
  if (rePrime === null || stayCost === null || moveCost === null) return false

  const savings = (stayCost - moveCost) * EXPECTED_REMAINING_ROUNDS
  return savings > rePrime
}

/** Should the loop escalate a tier? Based on observed trouble, not guesswork. */
export function shouldEscalate(signals: {
  consecutiveToolErrors: number
  round: number
  emptyResponses: number
}): number {
  if (signals.emptyResponses >= 2) return 2
  if (signals.consecutiveToolErrors >= 3) return 1
  if (signals.round >= 12) return 1
  return 0
}
