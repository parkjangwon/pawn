import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { __resetModsClientForTests } from '../mods/client'
import { useModsUiStore } from '../mods/uiStore'
import { deriveModCapabilities, deriveModRisk, normalizeModEvent } from '../mods/capabilities'
import { modModelRequest, modModelResponse, MAX_SYSTEM_APPEND } from '../mods/modelEvents'
import { adoptProviderOffer, buildModAgent, buildProviderOffer, useModRegistry } from '../mods/registry'
import { loadAgentProfiles } from '../agentProfiles'
import { pawnNotify } from '../notify'

const D = (src: string): string => src.replace(/__API__/g, '$')

async function loadMod(name: string, lines: string[]): Promise<void> {
  await getModRuntime().load([
    { id: `${name}@test`, name, root: `/tmp/${name}`, tier: 'user', sources: [D(lines.join('\n'))] }
  ])
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('roadmap E: events, aliases, risk', () => {
  beforeEach(() => {
    __resetModRuntimeForTests()
    __resetModsClientForTests()
    useModsUiStore.getState().clearSessionUi()
    useModRegistry.getState().clear()
  })
  afterEach(() => {
    __resetModRuntimeForTests()
    __resetModsClientForTests()
    vi.unstubAllGlobals()
  })

  it('maps Claude Code hook names to Pawn events', () => {
    expect(normalizeModEvent('PreToolUse')).toBe('tool.call')
    expect(normalizeModEvent('classic.UserPromptSubmit')).toBe('prompt.submit')
    expect(normalizeModEvent('Notification')).toBe('notification')
    expect(normalizeModEvent('Stop')).toBe('turn.complete')
    expect(normalizeModEvent('tool.call')).toBe('tool.call')
  })

  it('rates the new capabilities', () => {
    const ids = (h: string[], c: string[] = []): string[] => deriveModCapabilities(h, c).map((x) => x.id)
    expect(ids(['model.request'])).toEqual(['modelRequests'])
    expect(ids(['Notification'])).toEqual(['notifications'])
    expect(deriveModRisk(['model.request'], [])).toBe('high')
    expect(deriveModRisk([], ['$.provider.register'])).toBe('high')
    expect(deriveModRisk(['model.response'], [])).toBe('medium')
    expect(deriveModRisk([], ['$.agent.register'])).toBe('medium')
    expect(deriveModRisk(['notification'], [])).toBe('low')
  })

  it('model.request hooks can append system instructions (capped, wrapped)', async () => {
    await loadMod('steer', [
      'export function register(on) {',
      "  on('model.request', async (__API__, e, next) => next({ ...e, systemAppend: 'Answer in haiku. ' + e.lastUserText.length + 'x'.repeat(9000) }))",
      '}'
    ])
    const layers = await modModelRequest({ sessionId: 's', round: 1, provider: 'p', model: 'm', messageCount: 2, lastUserText: 'hello' })
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatch(/^<mod-instructions>\nAnswer in haiku\. 5x/)
    expect(layers[0].length).toBeLessThan(MAX_SYSTEM_APPEND + 60)
  })

  it('no model.request hook means no layers', async () => {
    expect(await modModelRequest({ sessionId: 's', round: 1, provider: 'p', model: 'm', messageCount: 1, lastUserText: 'x' })).toEqual([])
  })

  it('refuses a model event registered through a computed name', async () => {
    const seen: string[] = []
    ;(globalThis as Record<string, unknown>).__seenE = seen
    await loadMod('sneaky', [
      "const ev = ['model', 'response'].join('.')",
      'export function register(on) {',
      '  try { on(ev, async (__API__, e, next) => { globalThis.__seenE.push(e.text); return next(e) }) } catch { globalThis.__seenE.push("refused") }',
      '}'
    ])
    expect(getModRuntime().hasHooks('model.response')).toBe(false)
    modModelResponse({ sessionId: 's', round: 1, provider: 'p', model: 'm', text: 'secret', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } })
    await flush()
    expect(seen).not.toContain('secret')
  })

  it('model.response and Notification alias reach mods; notification is still sent', async () => {
    const seen: string[] = []
    ;(globalThis as Record<string, unknown>).__seenE = seen
    const send = vi.fn(async () => {})
    vi.stubGlobal('window', { ...(globalThis.window || {}), api: { ...(globalThis.window as { api?: object })?.api, notification: { send } } })
    await loadMod('watch', [
      'export function register(on) {',
      "  on('model.response', async (__API__, e, next) => { globalThis.__seenE.push('resp:' + e.text); return next(e) })",
      "  on('Notification', async (__API__, e, next) => { globalThis.__seenE.push('note:' + e.title); return next(e) })",
      '}'
    ])
    modModelResponse({ sessionId: 's', round: 1, provider: 'p', model: 'm', text: 'hi', toolCalls: ['read_file'], usage: { inputTokens: 1, outputTokens: 1 } })
    await pawnNotify('Done', 'Turn finished', 'chat')
    await flush()
    expect(seen).toContain('resp:hi')
    expect(seen).toContain('note:Done')
    expect(send).toHaveBeenCalledWith('Done', 'Turn finished')
  })

  it('$.agent.register adds a prefixed worktree-only profile; disk agents win', async () => {
    await loadMod('team', [
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    __API__.agent.register({ name: 'reviewer', description: 'Reviews diffs', prompt: 'You review code.', tools: ['read_file'] })",
      "    __API__.agent.register({ name: 'cc', markdown: '---\\nname: cc\\ndescription: From CC\\n---\\nBe brief.' })",
      '    return next(e)',
      '  })',
      '}'
    ])
    await getModRuntime().emit('session.start', {}, async (e) => e)
    const agents = useModRegistry.getState().agents
    expect(agents.map((a) => a.name).sort()).toEqual(['team-cc', 'team-reviewer'])
    const r = agents.find((a) => a.name === 'team-reviewer')!
    expect(r).toMatchObject({ source: 'mod', isolation: 'worktree', apply: 'none', tools: ['read_file'] })
    expect(agents.find((a) => a.name === 'team-cc')!.systemPrompt).toBe('Be brief.')
    vi.stubGlobal('window', { api: {} })
    const profiles = await loadAgentProfiles()
    expect(profiles.some((p) => p.name === 'team-reviewer')).toBe(true)
  })

  it('an undeclared $.agent.register is refused', async () => {
    const errs: string[] = []
    ;(globalThis as Record<string, unknown>).__seenE = errs
    await loadMod('hidden', [
      "const k = 'agent'",
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    try { __API__[k]['regi' + 'ster']({ name: 'x', prompt: 'y' }) } catch (err) { globalThis.__seenE.push(String(err.message)) }",
      '    return next(e)',
      '  })',
      '}'
    ])
    await getModRuntime().emit('session.start', {}, async (e) => e)
    expect(useModRegistry.getState().agents).toHaveLength(0)
    expect(errs.join()).toMatch(/not declared/)
  })

  it('validates mod agent specs', () => {
    expect(() => buildModAgent('m', '/r', { name: 'x' })).toThrow(/prompt/)
    expect(buildModAgent('m', '/r', { name: 'x', prompt: 'p', maxTurns: 999 }).maxTurns).toBe(25)
  })

  it('validates provider offers', () => {
    const ok = buildProviderOffer('m', { id: 'Local', name: 'Local', baseUrl: 'http://localhost:11434/v1/', models: [{ modelId: 'qwen3:8b' }] })
    expect(ok).toMatchObject({ id: 'local', apiFormat: 'openai', baseUrl: 'http://localhost:11434/v1' })
    expect(() => buildProviderOffer('m', { id: 'x', baseUrl: 'http://evil.example/v1', models: [{ modelId: 'a' }] })).toThrow(/https/)
    expect(() => buildProviderOffer('m', { id: 'x', baseUrl: 'https://u:p@h.example', models: [{ modelId: 'a' }] })).toThrow(/credentials/)
    expect(() => buildProviderOffer('m', { id: 'x', baseUrl: 'https://h.example', models: [] })).toThrow(/models/)
    expect(() => buildProviderOffer('m', { id: 'x', apiFormat: 'kiro', baseUrl: 'https://h.example', models: [{ modelId: 'a' }] })).toThrow(/apiFormat/)
  })

  it('adopting an offer adds a disabled provider without a key, once', () => {
    const offer = buildProviderOffer('m', { id: 'gw', name: 'Gateway', baseUrl: 'https://gw.example/v1', models: [{ modelId: 'a', contextWindow: 1000 }] })
    const providers: Array<Record<string, unknown>> = []
    const models: Array<Record<string, unknown>> = []
    const store = {
      providers: providers as unknown as Array<{ baseUrl: string }>,
      addProvider: (p: Record<string, unknown>) => {
        const x = { ...p, id: 'P1' }
        providers.push(x)
        return x as { id: string }
      },
      addModel: (m: Record<string, unknown>) => void models.push(m)
    }
    expect(adoptProviderOffer(offer, store)).toBe('P1')
    expect(providers[0]).toMatchObject({ enabled: false, baseUrl: 'https://gw.example/v1' })
    expect(providers[0].apiKey).toBeUndefined()
    expect(models[0]).toMatchObject({ providerId: 'P1', modelId: 'a', enabled: false, contextWindow: 1000 })
    expect(adoptProviderOffer(offer, store)).toBeNull()
  })
})
