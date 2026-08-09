import { describe, it, expect, beforeEach } from 'vitest'
import { useProviderStore } from '../../stores/provider'
import type { ModelEntry, ModelTier, Provider } from '../../types/provider'
import {
  route, estimateComplexity, estimateRoundCost, estimateRePrimeCost, routeKey,
  noteProviderFailure, noteProviderSuccess, isProviderAvailable, providerCooldownRemaining,
  shouldEscalate, setSessionRoute, clearSessionRoute,
  markVisionIncapable, clearVisionIncapable, isVisionCapabilityError
} from '../router'
import type { TranscriptEntry } from '../transcript'

function provider(id: string, name = id): Provider {
  return { id, name, apiFormat: 'openai', baseUrl: 'https://api.example.com/v1', enabled: true }
}

function model(providerId: string, modelId: string, tier: ModelTier, opts: Partial<ModelEntry> = {}): ModelEntry {
  return { id: `${providerId}:${modelId}`, providerId, modelId, label: modelId, tier, enabled: true, ...opts }
}

const pricing = (input: number, output: number, cacheRead: number, cacheWrite: number) =>
  ({ input, output, cacheRead, cacheWrite })

beforeEach(() => {
  clearVisionIncapable()
  useProviderStore.setState({
    providers: [],
    models: [],
    routingMode: 'auto',
    activeModelId: null,
    visionModelId: null
  })
})

describe('estimateComplexity', () => {
  it('classifies empty and short plain messages as simple', () => {
    expect(estimateComplexity('')).toBe('simple')
    expect(estimateComplexity('   ')).toBe('simple')
    expect(estimateComplexity('hello')).toBe('simple')
    expect(estimateComplexity('yes, do it')).toBe('simple')
  })

  it('flags code fences and long messages', () => {
    expect(estimateComplexity('fix this ```code```')).toBe('medium')
    expect(estimateComplexity('x'.repeat(200))).toBe('medium')
    expect(estimateComplexity('x'.repeat(500))).toBe('medium')
  })

  it('recognizes refactor/design keywords in Korean', () => {
    expect(estimateComplexity('이 코드를 리팩토링해줘')).toBe('medium')
    expect(estimateComplexity('그리고 나서 전체 구조를 분석해줘')).toBe('complex')
  })

  it('classifies long messages with heavy keywords as complex', () => {
    expect(estimateComplexity('x'.repeat(500) + ' 리팩토링')).toBe('complex')
  })

  it('ignores inline file blocks when measuring length', () => {
    const msg = '<file path="a.ts">' + 'x'.repeat(500) + '</file>\n간단히 요약해줘'
    expect(estimateComplexity(msg)).not.toBe('complex')
  })
})

describe('cost model', () => {
  const m = model('p', 'gpt-x', 'mid', { pricing: pricing(10, 20, 1, 5) })

  it('computes round cost with warm cache ratio', () => {
    const cost = estimateRoundCost(m, 100_000, 1000, 0.9)
    expect(cost).toBeCloseTo((90_000 * 1 + 10_000 * 10 + 1000 * 20) / 1_000_000)
  })

  it('returns null when pricing is unknown', () => {
    expect(estimateRoundCost(model('p', 'unknown-model', 'low'), 1000, 100, 0)).toBeNull()
  })

  it('computes re-prime cost from cacheWrite', () => {
    expect(estimateRePrimeCost(m, 100_000)).toBeCloseTo((100_000 * 5) / 1_000_000)
  })
})

describe('provider health', () => {
  it('puts a provider on escalating cooldown after failures', () => {
    noteProviderFailure('health-a')
    expect(isProviderAvailable('health-a')).toBe(false)
    expect(providerCooldownRemaining('health-a')).toBeGreaterThan(0)

    noteProviderFailure('health-a')
    expect(providerCooldownRemaining('health-a')).toBeGreaterThan(5000)

    noteProviderSuccess('health-a')
    expect(isProviderAvailable('health-a')).toBe(true)
    expect(providerCooldownRemaining('health-a')).toBe(0)
  })
})

describe('shouldEscalate', () => {
  it('escalates on empty responses, repeated tool errors, or long loops', () => {
    expect(shouldEscalate({ consecutiveToolErrors: 0, round: 0, emptyResponses: 0 })).toBe(0)
    expect(shouldEscalate({ consecutiveToolErrors: 0, round: 0, emptyResponses: 2 })).toBe(2)
    expect(shouldEscalate({ consecutiveToolErrors: 3, round: 0, emptyResponses: 0 })).toBe(1)
    expect(shouldEscalate({ consecutiveToolErrors: 0, round: 12, emptyResponses: 0 })).toBe(1)
  })
})

describe('route', () => {
  const entries: TranscriptEntry[] = []

  it('returns null when nothing is configured', () => {
    expect(route({ sessionId: 's', entries, complexity: 'simple' })).toBeNull()
  })

  it('picks the tier matching the complexity in auto mode', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low', { pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'mid-model', 'mid', { pricing: pricing(2, 4, 0.2, 2) }),
        model('p', 'high-model', 'high', { pricing: pricing(4, 8, 0.4, 4) })
      ]
    })
    expect(route({ sessionId: 's', entries, complexity: 'simple' })?.tier).toBe('low')
    expect(route({ sessionId: 's', entries, complexity: 'medium' })?.tier).toBe('mid')
    expect(route({ sessionId: 's', entries, complexity: 'complex' })?.tier).toBe('high')
  })

  it('respects maxTier cost pin for subagents', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low', { pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'mid-model', 'mid', { pricing: pricing(2, 4, 0.2, 2) }),
        model('p', 'high-model', 'high', { pricing: pricing(4, 8, 0.4, 4) })
      ],
      routingMode: 'auto'
    })
    const d = route({
      sessionId: 'sub-explore',
      entries,
      complexity: 'complex',
      maxTier: 'low'
    })
    expect(d?.tier).toBe('low')
    expect(d?.reason).toMatch(/maxTier/)
  })


  it('honours a manual pin', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low'),
        model('p', 'pinned-model', 'high')
      ],
      routingMode: 'manual',
      activeModelId: 'p:pinned-model'
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple' })
    expect(d?.model.modelId).toBe('pinned-model')
    expect(d?.reason).toBe('manual pin')
  })

  it('skips excluded models and falls back to an adjacent tier', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-a', 'low', { pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'low-b', 'low', { pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'mid-a', 'mid', { pricing: pricing(2, 4, 0.2, 2) })
      ]
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple', exclude: new Set(['p:low-a']) })
    expect(d?.model.modelId).toBe('low-b')
  })

  it('escalates the target tier on demand', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low'),
        model('p', 'high-model', 'high')
      ]
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple', escalate: 2 })
    expect(d?.tier).toBe('high')
  })

  it('prefers a healthy provider over one on cooldown', () => {
    noteProviderFailure('cool-p')
    useProviderStore.setState({
      providers: [provider('cool-p'), provider('warm-p')],
      models: [
        model('cool-p', 'cool-model', 'low'),
        model('warm-p', 'warm-model', 'low')
      ]
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple' })
    expect(d?.provider.id).toBe('warm-p')
  })

  it('keeps a warm high-tier session instead of downgrading mid-turn', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low'),
        model('p', 'high-model', 'high')
      ]
    })
    setSessionRoute('sticky-session', 'p:high-model', 'high', 1000)
    const d = route({ sessionId: 'sticky-session', entries, complexity: 'simple', newTurn: false })
    expect(d?.model.modelId).toBe('high-model')
    expect(d?.reason).toContain('sticky')
  })

  it('downgrades at a user-turn boundary when savings repay the re-prime', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low', { pricing: pricing(5, 20, 0.5, 5) }),
        model('p', 'high-model', 'high', { pricing: pricing(100, 200, 10, 100) })
      ]
    })
    setSessionRoute('downgrade-session', 'p:high-model', 'high', 1000)
    const bigPrompt = { role: 'user' as const, content: 'x'.repeat(200_000) }
    const d = route({
      sessionId: 'downgrade-session',
      entries: [bigPrompt],
      complexity: 'simple',
      newTurn: true
    })
    expect(d?.tier).toBe('low')
    expect(d?.reason).toContain('downgrade')
  })

  it('falls back to the excluded model when nothing else is usable', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [model('p', 'only-model', 'low')]
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple', exclude: new Set(['p:only-model']) })
    expect(d?.model.modelId).toBe('only-model')
  })

  it('builds stable route keys from provider and model ids', () => {
    expect(routeKey(model('prov', 'model-x', 'low'))).toBe('prov:model-x')
  })

  it('never picks disabled providers or models', () => {
    useProviderStore.setState({
      providers: [{ ...provider('off-p'), enabled: false }, provider('on-p')],
      models: [
        model('off-p', 'off-model', 'low'),
        model('on-p', 'on-model', 'low')
      ]
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple' })
    expect(d?.provider.id).toBe('on-p')
  })

  it('skips models whose context window cannot hold the transcript', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'tiny-model', 'low', { contextWindow: 2000, pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'big-model', 'mid', { contextWindow: 200_000, pricing: pricing(2, 4, 0.2, 2) })
      ]
    })
    const bigPrompt = { role: 'user' as const, content: 'x'.repeat(10_000) }
    const d = route({ sessionId: 's', entries: [bigPrompt], complexity: 'simple' })
    expect(d?.model.modelId).toBe('big-model')
    expect(d?.reason).not.toContain('context too small')
  })

  it('falls back to small-context models when nothing fits, with a note', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'tiny-model', 'low', { contextWindow: 2000, pricing: pricing(1, 2, 0.1, 1) })
      ]
    })
    const bigPrompt = { role: 'user' as const, content: 'x'.repeat(10_000) }
    const d = route({ sessionId: 's', entries: [bigPrompt], complexity: 'simple' })
    expect(d?.model.modelId).toBe('tiny-model')
    expect(d?.reason).toContain('context too small')
  })

  it('drops a stale sticky tier when the warm model no longer exists', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'low-model', 'low'),
        model('p', 'high-model', 'high')
      ]
    })
    // The warm key references a model that is no longer in the pool.
    setSessionRoute('stale-session', 'p:gone-model', 'high', 5000)
    const d = route({ sessionId: 'stale-session', entries, complexity: 'simple', newTurn: true })
    expect(d?.tier).toBe('low')
    expect(d?.reason).toContain('auto')
  })

  it('stays on the warm model within the same tier instead of the cheapest', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'cheap-model', 'low', { pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'warm-model', 'low', { pricing: pricing(50, 100, 5, 50) })
      ]
    })
    setSessionRoute('warm-tier-session', 'p:warm-model', 'low', 1000)
    const d = route({ sessionId: 'warm-tier-session', entries, complexity: 'simple' })
    expect(d?.model.modelId).toBe('warm-model')
  })

  it('picks the cheapest model when no cache is warm', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'cheap-model', 'low', { pricing: pricing(1, 2, 0.1, 1) }),
        model('p', 'pricey-model', 'low', { pricing: pricing(50, 100, 5, 50) })
      ]
    })
    const d = route({ sessionId: 'cold-session', entries, complexity: 'simple' })
    expect(d?.model.modelId).toBe('cheap-model')
  })

  it('keeps a vision-capable natural pick on image turns (no forced fallback)', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'gemini', 'low', { supportsVision: true }),
        model('p', 'vision-fallback', 'mid', { supportsVision: true })
      ],
      routingMode: 'manual',
      activeModelId: 'p:gemini',
      visionModelId: 'p:vision-fallback'
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple', needsVision: true })
    expect(d?.model.modelId).toBe('gemini')
    expect(d?.ephemeral).toBeUndefined()
    expect(d?.reason).toBe('manual pin')
  })

  it('falls back from a text-only pin to the preferred vision model', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'deepseek', 'mid', { supportsVision: false }),
        model('p', 'gpt-4o-mini', 'low', { supportsVision: true })
      ],
      routingMode: 'manual',
      activeModelId: 'p:deepseek',
      visionModelId: 'p:gpt-4o-mini'
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple', needsVision: true })
    expect(d?.model.modelId).toBe('gpt-4o-mini')
    expect(d?.ephemeral).toBe(true)
    expect(d?.reason).toBe('vision fallback (preferred)')
  })

  it('falls back to any known-vision model when no preferred is set', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'deepseek', 'mid', { supportsVision: false }),
        model('p', 'claude', 'mid', { supportsVision: true })
      ],
      routingMode: 'manual',
      activeModelId: 'p:deepseek',
      visionModelId: null
    })
    const d = route({ sessionId: 's', entries, complexity: 'simple', needsVision: true })
    expect(d?.model.modelId).toBe('claude')
    expect(d?.reason).toBe('vision fallback')
  })

  it('returns null on image turns when only text-only models exist', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [model('p', 'deepseek', 'mid', { supportsVision: false })],
      routingMode: 'manual',
      activeModelId: 'p:deepseek'
    })
    expect(route({ sessionId: 's', entries, complexity: 'simple', needsVision: true })).toBeNull()
  })

  it('skips a model marked vision-incapable at runtime', () => {
    useProviderStore.setState({
      providers: [provider('p')],
      models: [
        model('p', 'maybe-vision', 'mid', { supportsVision: undefined }),
        model('p', 'real-vision', 'low', { supportsVision: true })
      ],
      routingMode: 'manual',
      activeModelId: 'p:maybe-vision'
    })
    markVisionIncapable('p:maybe-vision')
    const d = route({ sessionId: 's', entries, complexity: 'simple', needsVision: true })
    expect(d?.model.modelId).toBe('real-vision')
    expect(d?.ephemeral).toBe(true)
  })
})

describe('isVisionCapabilityError', () => {
  it('detects clear vision rejection messages', () => {
    expect(isVisionCapabilityError(new Error('model does not support image input'))).toBe(true)
    expect(isVisionCapabilityError('Images are not supported for this model')).toBe(true)
    expect(isVisionCapabilityError(new Error('rate limit exceeded'))).toBe(false)
  })

  it('does not match broad or unrelated errors', () => {
    expect(isVisionCapabilityError(new Error('invalid content'))).toBe(false)
    expect(isVisionCapabilityError(new Error('revision failed'))).toBe(false)
    expect(isVisionCapabilityError(new Error('provision timed out'))).toBe(false)
  })
})
