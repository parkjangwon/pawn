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
import {
  guessPricing,
  guessSupportsVision,
  type ModelEntry,
  type ModelPricing,
  type ModelTier,
  type Provider
} from '../types/provider'
import { estimateTokens, type TranscriptEntry } from './transcript'

// Models that refused an image this session — treated as non-vision until restart.
const visionIncapableKeys = new Set<string>()

export function markVisionIncapable(key: string): void {
  visionIncapableKeys.add(key)
}

export function clearVisionIncapable(key?: string): void {
  if (key) visionIncapableKeys.delete(key)
  else visionIncapableKeys.clear()
}

export function isKnownVisionIncapable(key: string): boolean {
  return visionIncapableKeys.has(key)
}

/**
 * True when the provider error clearly means "this model cannot take images".
 * Keep this narrow: broad substrings like bare "vision" match "revision", and
 * "invalid content" matches ordinary API failures — which wrongly banned vision
 * fallbacks for the whole session.
 */
export function isVisionCapabilityError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (!msg) return false
  const phrases = [
    'does not support image',
    'do not support image',
    "doesn't support image",
    'images are not supported',
    'image is not supported',
    'image input is not supported',
    'image inputs are not supported',
    'images not supported',
    'unsupported image',
    'image_url is not supported',
    'image_url not supported',
    'no support for image',
    'cannot process image',
    'unable to process image',
    'model does not support multimodal',
    'not a multimodal',
    'multimodal is not supported',
    'vision is not supported',
    'does not support vision',
    'image modalities are not supported',
    'modality.*image.*not supported'
  ]
  return phrases.some((n) => {
    if (n.includes('.*')) return new RegExp(n).test(msg)
    return msg.includes(n)
  })
}

function canAttemptVision(model: ModelEntry): boolean {
  if (model.supportsVision === false) return false
  // Explicitly vision-capable models are never session-banned from broad errors;
  // only unknown/false models use the runtime denylist.
  if (model.supportsVision === true) return true
  if (isKnownVisionIncapable(routeKey(model))) return false
  return true
}

/** Effective vision capability including id heuristics when unset. */
function isEffectivelyVisionCapable(model: ModelEntry): boolean {
  if (model.supportsVision === true) return true
  if (model.supportsVision === false) return false
  return guessSupportsVision(model.modelId) === true
}

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
  /**
   * True when this pick was only for an image turn (vision fallback).
   * Callers should not update session stickiness so text turns stay on the
   * user's preferred non-vision model (e.g. DeepSeek).
   */
  ephemeral?: boolean
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
  if (!h) return true
  if (h.cooldownUntil <= Date.now()) {
    health.delete(providerId)
    return true
  }
  return false
}

export function providerCooldownRemaining(providerId: string): number {
  const h = health.get(providerId)
  return h ? Math.max(0, h.cooldownUntil - Date.now()) : 0
}

// --- Measured pricing -------------------------------------------------------
// Static rate snapshots drift. Recent usage rows give a per-model cost scale
// factor, so auto routing tracks what the provider actually charged.

const measuredScale = new Map<string, number>()
let lastPricingRefresh = 0

export async function refreshMeasuredPricing(minIntervalMs = 5 * 60_000): Promise<void> {
  const now = Date.now()
  if (now - lastPricingRefresh < minIntervalMs) return
  lastPricingRefresh = now
  try {
    const since = Math.floor(now / 1000) - 7 * 86400
    const rows = await window.api.db.getUsageSummary(since) as Array<{
      modelId: string
      providerId: string
      calls: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      cost: number
    }>
    const next = new Map<string, number>()
    for (const r of rows) {
      const staticP = guessPricing(r.modelId)
      const tokens = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens
      if (!staticP || tokens <= 0 || r.cost <= 0) continue
      const expected =
        (r.inputTokens * staticP.input + r.outputTokens * staticP.output +
          r.cacheReadTokens * staticP.cacheRead + r.cacheWriteTokens * staticP.cacheWrite) / 1_000_000
      if (expected > 0) {
        const scale = r.cost / expected
        // Reject absurd outliers; a sane range keeps one bad row from flipping
        // the whole routing table.
        if (scale > 0.1 && scale < 10) next.set(r.modelId, scale)
      }
    }
    measuredScale.clear()
    for (const [key, value] of next) measuredScale.set(key, value)
  } catch {
    // Keep the previous scale; routing falls back to static pricing.
  }
}

function effectivePricing(model: ModelEntry): ModelPricing | undefined {
  const scale = measuredScale.get(model.modelId)
  if (scale && model.pricing) {
    return {
      input: model.pricing.input * scale,
      output: model.pricing.output * scale,
      cacheRead: model.pricing.cacheRead * scale,
      cacheWrite: model.pricing.cacheWrite * scale
    }
  }
  return model.pricing
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
  const p = effectivePricing(model)
  if (!p) return null
  const cached = promptTokens * warmRatio
  const fresh = promptTokens - cached
  return (cached * p.cacheRead + fresh * p.input + outputTokens * p.output) / 1_000_000
}

/** One-time cost of moving a session's warm prefix onto a different model. */
export function estimateRePrimeCost(model: ModelEntry, promptTokens: number): number | null {
  const p = effectivePricing(model)
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

interface WarmCache {
  key: string
  /** Share of the current prompt already sitting in this model's cache. */
  ratio: number
}

/**
 * Rank same-tier candidates: healthy first, then the session's warm model
 * (cache stability beats marginal price differences), then cheapest, then
 * stable by id.
 */
function rank(list: RouteTarget[], promptTokens: number, warm: WarmCache | null): RouteTarget[] {
  return list.slice().sort((a, b) => {
    const aUp = isProviderAvailable(a.provider.id) ? 0 : 1
    const bUp = isProviderAvailable(b.provider.id) ? 0 : 1
    if (aUp !== bUp) return aUp - bUp

    const aWarm = warm ? routeKey(a.model) === warm.key : false
    const bWarm = warm ? routeKey(b.model) === warm.key : false
    if (aWarm !== bWarm) return aWarm ? -1 : 1

    // A model whose cache is already warm for this session gets its input priced
    // at the cache-read rate; everything else pays full freight.
    const aCost = estimateRoundCost(a.model, promptTokens, 1000, aWarm ? warm!.ratio : 0)
    const bCost = estimateRoundCost(b.model, promptTokens, 1000, bWarm ? warm!.ratio : 0)
    if (aCost !== null && bCost !== null && aCost !== bCost) return aCost - bCost
    if (aCost === null && bCost !== null) return 1
    if (aCost !== null && bCost === null) return -1

    return a.model.id.localeCompare(b.model.id)
  })
}

/** A model can carry the transcript when the estimate fits with headroom. */
function fitsContext(model: ModelEntry, promptTokens: number): boolean {
  if (!model.contextWindow || model.contextWindow <= 0) return true
  return promptTokens <= model.contextWindow * 0.6
}

/** Share of the current prompt that was warm at the last successful call. */
function warmRatio(sticky: SessionRoute, promptTokens: number): number {
  if (promptTokens > 0 && sticky.warmTokens > 0) {
    return Math.min(0.95, Math.max(0, sticky.warmTokens / promptTokens))
  }
  return 0.9
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
  /** Transcript includes images — prefer vision-capable models / optional fallback. */
  needsVision?: boolean
}

/**
 * Resolve the model for the next request. Returns null only when nothing is
 * configured at all (or nothing vision-capable when needsVision and no fallback);
 * every other failure mode degrades to an adjacent tier or a different provider
 * rather than giving up.
 */
export function route(req: RouteRequest): RouteDecision | null {
  const base = routeBase(req)
  if (!base || !req.needsVision) return base
  return applyVisionPolicy(req, base)
}

/**
 * Core routing without vision overrides. Kept separate so vision fallback can
 * still use the user's preferred text model as the first attempt when it might
 * be multimodal.
 */
function routeBase(req: RouteRequest): RouteDecision | null {
  const { routingMode, activeModelId } = useProviderStore.getState()
  const all = candidates()
  if (all.length === 0) return null

  const exclude = req.exclude || new Set<string>()
  const promptTokens = estimateTokens(req.entries)
  // Models whose context window cannot hold the transcript are not candidates;
  // if none fit at all, fall back to everything rather than giving up.
  const contextFit = all.filter((c) => fitsContext(c.model, promptTokens))
  const basePool = contextFit.length > 0 ? contextFit : all
  const contextLimited = contextFit.length === 0
  const usable = basePool.filter((c) => !exclude.has(routeKey(c.model)))
  const pool = usable.length > 0 ? usable : basePool
  const sticky = sessionRoutes.get(req.sessionId)
  const warm = sticky && !exclude.has(sticky.key) ? { key: sticky.key, ratio: warmRatio(sticky, promptTokens) } : null

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
    const current = pool.find((c) => routeKey(c.model) === sticky.key)
    if (current) {
      const stickyIdx = TIER_ORDER.indexOf(sticky.tier)
      if (stickyIdx > targetIdx) {
        // The session is already on a stronger model with a warm prefix. Only step
        // down if the remaining conversation is long enough for the savings to
        // repay the re-prime, and only at a user-turn boundary.
        const target = rank(pool.filter((c) => c.model.tier === TIER_ORDER[targetIdx]), promptTokens, warm)[0]
        const worthIt = req.newTurn === true && target && isDowngradeWorthIt(current.model, target.model, promptTokens, warm!.ratio)
        if (!worthIt) {
          targetIdx = stickyIdx
          reason = 'sticky: keeping warm cache'
        } else {
          reason = `auto: ${req.complexity} (downgrade pays for re-prime)`
        }
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

  for (const tier of order) {
    const tierPool = rank(pool.filter((c) => c.model.tier === tier), promptTokens, warm)
    const healthy = tierPool.find((c) => isProviderAvailable(c.provider.id))
    const pick = healthy || tierPool[0]
    if (!pick) continue
    const key = routeKey(pick.model)
    const note = (tier === TIER_ORDER[targetIdx] ? reason : `${reason} → fell back to ${tier}`) +
      (contextLimited ? ' (context too small for smaller models)' : '')
    return { ...pick, key, tier, reason: healthy ? note : `${note} (all providers cooling down)` }
  }

  const last = rank(pool, promptTokens, warm)[0]
  return last
    ? { ...last, key: routeKey(last.model), tier: last.model.tier, reason: 'only model available' + (contextLimited ? ' (context too small)' : '') }
    : null
}

/**
 * Prefer the model we would have used when it can see images; otherwise fall
 * back to the optional vision model, then any known-vision model. Does not
 * silently send images to a known text-only model.
 */
function applyVisionPolicy(req: RouteRequest, base: RouteDecision): RouteDecision | null {
  const exclude = req.exclude || new Set<string>()
  const promptTokens = estimateTokens(req.entries)
  const all = candidates()
  // Prefer context-fit models, but never drop the entire vision pool when
  // estimateTokens was wrong historically (huge base64) — fall back to all.
  const contextFit = all.filter((c) => fitsContext(c.model, promptTokens))
  const basePool = contextFit.length > 0 ? contextFit : all
  let pool = basePool.filter((c) => !exclude.has(routeKey(c.model)))
  if (pool.length === 0) pool = basePool

  // 1) Natural pick can try vision (explicit true, or unknown not yet failed).
  // Prefer explicit vision models over text-only sticky when needsVision.
  if (
    !exclude.has(base.key) &&
    canAttemptVision(base.model) &&
    base.model.supportsVision !== false
  ) {
    // If natural pick is only "unknown" but a known vision model exists, skip to fallbacks.
    if (base.model.supportsVision === true) {
      return base
    }
  }

  const sticky = sessionRoutes.get(req.sessionId)
  const warm = sticky && !exclude.has(sticky.key) ? { key: sticky.key, ratio: warmRatio(sticky, promptTokens) } : null
  const { visionModelId } = useProviderStore.getState()

  // 2) User-preferred vision fallback (by model entry id).
  if (visionModelId) {
    const preferred = pool.find((c) => c.model.id === visionModelId)
    if (preferred && canAttemptVision(preferred.model)) {
      return {
        ...preferred,
        key: routeKey(preferred.model),
        tier: preferred.model.tier,
        reason: 'vision fallback (preferred)',
        ephemeral: true
      }
    }
    // Preferred set but not in filtered pool — try full candidate list once.
    const preferredAny = all.find((c) => c.model.id === visionModelId && !exclude.has(routeKey(c.model)))
    if (preferredAny && canAttemptVision(preferredAny.model)) {
      return {
        ...preferredAny,
        key: routeKey(preferredAny.model),
        tier: preferredAny.model.tier,
        reason: 'vision fallback (preferred, ignore context filter)',
        ephemeral: true
      }
    }
  }

  // 3) Any model that can see (explicit Vision flag OR known multimodal id).
  const visionFilter = (c: RouteTarget) =>
    canAttemptVision(c.model) && isEffectivelyVisionCapable(c.model)

  const knownVision = rank(pool.filter(visionFilter), promptTokens, warm)
  if (knownVision[0]) {
    const pick = knownVision.find((c) => isProviderAvailable(c.provider.id)) || knownVision[0]
    return {
      ...pick,
      key: routeKey(pick.model),
      tier: pick.model.tier,
      reason: 'vision fallback',
      ephemeral: true
    }
  }
  // Same, from full list if pool was over-filtered.
  const knownVisionAll = rank(
    all.filter((c) => visionFilter(c) && !exclude.has(routeKey(c.model))),
    promptTokens,
    warm
  )
  if (knownVisionAll[0]) {
    const pick = knownVisionAll.find((c) => isProviderAvailable(c.provider.id)) || knownVisionAll[0]
    return {
      ...pick,
      key: routeKey(pick.model),
      tier: pick.model.tier,
      reason: 'vision fallback (any enabled)',
      ephemeral: true
    }
  }

  // 4) Natural pick if unknown capability and not banned.
  if (!exclude.has(base.key) && canAttemptVision(base.model) && base.model.supportsVision !== false) {
    return { ...base, reason: `${base.reason} (try vision)` }
  }

  // 5) Unknown-capability models (not explicitly false) as last resort try.
  const unknown = rank(
    pool.filter((c) => c.model.supportsVision === undefined && canAttemptVision(c.model)),
    promptTokens,
    warm
  )
  if (unknown[0]) {
    const pick = unknown.find((c) => isProviderAvailable(c.provider.id)) || unknown[0]
    return {
      ...pick,
      key: routeKey(pick.model),
      tier: pick.model.tier,
      reason: 'vision fallback (try unknown)',
      ephemeral: true
    }
  }

  // Nothing left that can even attempt images.
  return null
}

/** Human-readable reason when no vision route exists (for chat errors). */
export function describeVisionRouteFailure(): string {
  const all = candidates()
  const visionMarked = all.filter((c) => c.model.supportsVision === true)
  const { visionModelId, models } = useProviderStore.getState()
  if (all.length === 0) return 'no_models'
  if (visionMarked.length === 0) {
    const preferred = visionModelId ? models.find((m) => m.id === visionModelId) : null
    if (preferred && !preferred.enabled) return 'fallback_disabled'
    if (preferred && !all.some((c) => c.model.id === preferred.id)) return 'fallback_provider_off'
    return 'no_vision_models'
  }
  return 'vision_unavailable'
}

/**
 * A downgrade is only worth it if the cheaper model saves more over the expected
 * remaining rounds than the one-off cache write costs. Without this check auto
 * mode oscillates between tiers and pays a re-prime on every oscillation — which
 * is exactly how naive "auto" routing ends up more expensive than a fixed model.
 */
function isDowngradeWorthIt(from: ModelEntry, to: ModelEntry, promptTokens: number, ratio: number): boolean {
  const EXPECTED_REMAINING_ROUNDS = 6
  const OUTPUT_PER_ROUND = 800

  const rePrime = estimateRePrimeCost(to, promptTokens)
  const stayCost = estimateRoundCost(from, promptTokens, OUTPUT_PER_ROUND, ratio)
  // The first round on the new model is cold; later rounds read the primed cache.
  const moveCold = estimateRoundCost(to, promptTokens, OUTPUT_PER_ROUND, 0)
  const moveWarm = estimateRoundCost(to, promptTokens, OUTPUT_PER_ROUND, ratio)
  if (rePrime === null || stayCost === null || moveCold === null || moveWarm === null) return false

  const stayTotal = stayCost * EXPECTED_REMAINING_ROUNDS
  const moveTotal = moveCold + moveWarm * (EXPECTED_REMAINING_ROUNDS - 1) + rePrime
  return moveTotal < stayTotal
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
