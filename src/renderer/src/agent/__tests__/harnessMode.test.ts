import { describe, it, expect, beforeEach } from 'vitest'
import { useProviderStore } from '../../stores/provider'
import type { ModelEntry, ModelTier, Provider } from '../../types/provider'
import { route, setSessionRoute, clearSessionRoute, routeKey } from '../router'
import {
  claudeThinkingBudget,
  contextFitRatio,
  deepSeekEffort,
  effectiveCostMode,
  effectiveDoneGate,
  effectivePoolLimit,
  effectiveReasoningEffort,
  harnessPreamble,
  harnessProfile,
  parseHarnessMode
} from '../harnessMode'
import { createAdaptiveLimit, mapPool, normalizeParallelTasks } from '../subagentCore'
import { toolResultCap } from '../../stores/chatTranscript'

function provider(id: string): Provider {
  return { id, name: id, apiFormat: 'openai', baseUrl: 'https://api.example.com/v1', enabled: true }
}

function model(modelId: string, tier: ModelTier, input: number): ModelEntry {
  return {
    id: `p:${modelId}`,
    providerId: 'p',
    modelId,
    label: modelId,
    tier,
    enabled: true,
    pricing: { input, output: input * 4, cacheRead: input / 10, cacheWrite: input * 1.25 }
  }
}

// Two models per tier so same-tier ranking (cheapest vs strongest) is observable.
const MODELS = [
  model('low-cheap', 'low', 0.1),
  model('low-pricey', 'low', 0.5),
  model('mid-cheap', 'mid', 1),
  model('mid-pricey', 'mid', 3),
  model('high-cheap', 'high', 5),
  model('high-pricey', 'high', 15)
]

beforeEach(() => {
  clearSessionRoute('s')
  useProviderStore.setState({
    providers: [provider('p')],
    models: MODELS,
    routingMode: 'auto',
    activeModelId: null,
    visionModelId: null,
    harnessMode: 'default'
  })
})

const pick = (complexity: 'simple' | 'medium' | 'complex', harnessMode?: 'default' | 'eco' | 'maxing', extra = {}) =>
  route({ sessionId: 's', entries: [], complexity, newTurn: true, harnessMode, ...extra })

describe('harness profiles', () => {
  it('parses unknown values to default', () => {
    expect(parseHarnessMode('eco')).toBe('eco')
    expect(parseHarnessMode('maxing')).toBe('maxing')
    expect(parseHarnessMode('monster')).toBe('default')
    expect(parseHarnessMode(undefined)).toBe('default')
  })

  it('default profile matches the pre-mode constants', () => {
    const p = harnessProfile('default')
    expect(p.maxToolRounds).toBe(50)
    expect(p.compactAtRatio).toBe(0.6)
    expect(p.maxParallelTasks).toBe(6)
    expect(p.parallelPool).toBeNull()
    expect(p.tierFor).toEqual({ simple: 'low', medium: 'mid', complex: 'high' })
    expect(harnessPreamble('default')).toBe('')
    expect(contextFitRatio('default')).toBe(0.6)
  })

  it('eco tightens and maxing widens every budget', () => {
    const eco = harnessProfile('eco')
    const max = harnessProfile('maxing')
    expect(eco.maxToolRounds).toBeLessThan(50)
    expect(max.maxToolRounds).toBeGreaterThan(50)
    expect(eco.compactAtRatio).toBeLessThan(0.6)
    expect(max.compactAtRatio).toBeGreaterThan(0.6)
    expect(eco.maxParallelTasks).toBeLessThan(6)
    expect(max.maxParallelTasks).toBeGreaterThan(6)
    // Router must not evict the current model before maxing compaction kicks in.
    expect(contextFitRatio('maxing')).toBeGreaterThan(max.compactAtRatio)
  })

  it('preambles name the mode', () => {
    expect(harnessPreamble('eco')).toContain('ECO')
    expect(harnessPreamble('maxing')).toContain('MAXING')
    expect(harnessPreamble('maxing')).toContain('Permissions, Plan mode, and spend budgets still apply')
  })
})

describe('explicit user settings win over modes', () => {
  it('reasoning effort', () => {
    expect(effectiveReasoningEffort('auto', 'eco')).toBe('low')
    expect(effectiveReasoningEffort('auto', 'maxing')).toBe('high')
    expect(effectiveReasoningEffort('auto', 'default')).toBe('auto')
    expect(effectiveReasoningEffort('medium', 'maxing')).toBe('medium')
  })

  it('claude thinking stays off in eco and goes deep in maxing', () => {
    expect(claudeThinkingBudget('auto', 'eco')).toBeUndefined()
    expect(claudeThinkingBudget('auto', 'default')).toBeUndefined()
    expect(claudeThinkingBudget('auto', 'maxing')).toBe(16_384)
    expect(claudeThinkingBudget('low', 'maxing')).toBe(2048)
    expect(claudeThinkingBudget('high', 'default')).toBe(8192)
  })

  it('deepseek effort', () => {
    expect(deepSeekEffort('auto', 'eco')).toBe('auto')
    expect(deepSeekEffort('auto', 'maxing')).toBe('max')
    expect(deepSeekEffort('low', 'maxing')).toBe('low')
  })

  it('subagent cost mode: eco frugal, maxing keeps role pins', () => {
    expect(effectiveCostMode('balanced', 'eco')).toBe('frugal')
    expect(effectiveCostMode('balanced', 'maxing')).toBe('balanced')
    expect(effectiveCostMode('quality', 'eco')).toBe('quality')
  })

  it('pool, done gate, memory', () => {
    expect(effectivePoolLimit(3, 'default')).toBe(3)
    expect(effectivePoolLimit(3, 'eco')).toBe(2)
    expect(effectivePoolLimit(3, 'maxing')).toBe(8)
    expect(effectiveDoneGate('off', 'maxing')).toBe('off')
    expect(effectiveDoneGate('typecheck', 'maxing')).toBe('test')
    expect(effectiveDoneGate('test', 'eco')).toBe('typecheck')
  })
})

describe('router × harness mode', () => {
  it('default routing is unchanged', () => {
    expect(pick('simple', 'default')?.model.modelId).toBe('low-cheap')
    expect(pick('medium', 'default')?.model.modelId).toBe('mid-cheap')
    expect(pick('complex', 'default')?.model.modelId).toBe('high-cheap')
    expect(pick('complex', 'default')?.reason).toBe('auto: complex')
  })

  it('eco maps down a tier, caps at mid, and picks the cheapest', () => {
    expect(pick('simple', 'eco')?.model.modelId).toBe('low-cheap')
    expect(pick('medium', 'eco')?.model.modelId).toBe('low-cheap')
    expect(pick('complex', 'eco')?.model.modelId).toBe('mid-cheap')
    expect(pick('complex', 'eco')?.reason).toMatch(/^eco: /)
  })

  it('eco still escalates past the ceiling after failures', () => {
    expect(pick('complex', 'eco', { escalate: 1 })?.tier).toBe('high')
  })

  it('maxing sends medium/complex to high on the strongest model, simple stays cheap', () => {
    expect(pick('simple', 'maxing')?.model.modelId).toBe('low-pricey')
    expect(pick('medium', 'maxing')?.model.modelId).toBe('high-pricey')
    expect(pick('complex', 'maxing')?.model.modelId).toBe('high-pricey')
    expect(pick('complex', 'maxing')?.reason).toMatch(/^maxing: /)
  })

  it('subagent maxTier pins still apply in maxing', () => {
    expect(pick('complex', 'maxing', { maxTier: 'low' })?.tier).toBe('low')
  })

  it('reads the global mode from the store when not passed', () => {
    useProviderStore.setState({ harnessMode: 'maxing' })
    expect(pick('medium')?.tier).toBe('high')
  })

  it('manual pin wins in every mode', () => {
    useProviderStore.setState({ routingMode: 'manual', activeModelId: 'p:mid-cheap' })
    expect(pick('complex', 'maxing')?.model.modelId).toBe('mid-cheap')
    expect(pick('simple', 'eco')?.model.modelId).toBe('mid-cheap')
  })

  it('eco downgrades a warm high-tier session at the next user turn', () => {
    const high = MODELS.find((m) => m.modelId === 'high-pricey')!
    setSessionRoute('s', routeKey(high), 'high', 50_000)
    expect(pick('simple', 'eco')?.tier).toBe('low')
    // Mid-turn (newTurn=false) keeps the warm model even above the eco ceiling.
    expect(pick('simple', 'eco', { newTurn: false })?.model.modelId).toBe('high-pricey')
  })
})

describe('parallel fan-out', () => {
  it('normalizeParallelTasks honours the per-mode cap', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({ prompt: `t${i}` }))
    expect(normalizeParallelTasks(tasks)).toHaveLength(6)
    expect(normalizeParallelTasks(tasks, harnessProfile('maxing').maxParallelTasks)).toHaveLength(12)
    expect(normalizeParallelTasks(tasks, harnessProfile('eco').maxParallelTasks)).toHaveLength(3)
  })

  it('adaptive limit halves on failures and recovers over time', () => {
    let failures = 0
    let t = 0
    const limit = createAdaptiveLimit(8, () => failures, { recoverMs: 100, now: () => t })
    expect(limit()).toBe(8)
    failures = 1
    expect(limit()).toBe(4)
    failures = 3
    expect(limit()).toBe(2)
    t += 50
    expect(limit()).toBe(2)
    t += 100
    expect(limit()).toBe(3)
    t += 100
    expect(limit()).toBe(4)
  })

  it('mapPool respects a dynamic concurrency ceiling', async () => {
    let active = 0
    let peak = 0
    const out = await mapPool(
      Array.from({ length: 8 }, (_, i) => i),
      8,
      async (n) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return n * 2
      },
      { dynamicLimit: () => 2, pollMs: 1 }
    )
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('tool result caps', () => {
  it('scales per-tool caps with a floor', () => {
    expect(toolResultCap('read_file')).toBe(80_000)
    expect(toolResultCap('read_file', 0.5)).toBe(40_000)
    expect(toolResultCap('read_file', 1.5)).toBe(120_000)
    expect(toolResultCap('unknown_tool')).toBe(12_000)
    expect(toolResultCap('write_file', 0.1)).toBe(2_000)
  })
})
