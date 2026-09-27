// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildKiroRequest, kiroConversationId, sanitizeSchema, toKiroModelId } from '../kiroWire'
import { callLLM } from '../llm'
import { mergeRemoteModels } from '../listModels'
import { useProviderStore } from '../../stores/provider'
import type { TranscriptEntry } from '../transcript'

const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [], additionalProperties: false } })
const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('Kiro request builder', () => {
  const entries: TranscriptEntry[] = [
    { role: 'user', content: 'fix a.ts', attachments: [{ kind: 'image', dataUrl: PNG }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'a.ts' } }, { id: 't2', name: 'mcp__very_long_server_name_for_testing__and_an_even_longer_tool_name_here', arguments: {} }] },
    { role: 'tool', toolCallId: 't1', name: 'read_file', content: 'export const a = 1' },
    { role: 'tool', toolCallId: 't2', name: 'mcp__x', content: 'boom', isError: true },
    { role: 'user', content: '[auto_verify] typecheck failed' },
    { role: 'assistant', content: 'Fixing.', toolCalls: [{ id: 't3', name: 'computer_screenshot', arguments: {} }] },
    { role: 'tool', toolCallId: 't3', name: 'computer_screenshot', content: `screenshot 2x2\n${PNG}` }
  ]
  const tools = [tool('read_file'), tool('computer_screenshot'), tool('mcp__very_long_server_name_for_testing__and_an_even_longer_tool_name_here')]

  it('builds alternating turns with tool results on the next user turn and the system prompt up front', () => {
    const { body, toolNames } = buildKiroRequest({ entries, systemText: 'SYSTEM', tools, modelId: 'claude-sonnet-4-5-20250929', conversationId: 'cid' })
    const cs = body.conversationState as Record<string, any>
    expect(cs.chatTriggerType).toBe('MANUAL')
    expect(cs.conversationId).toBe('cid')
    const h = cs.history as Array<Record<string, any>>
    expect(h.map((m) => Object.keys(m)[0])).toEqual(['userInputMessage', 'assistantResponseMessage', 'userInputMessage', 'assistantResponseMessage'])
    expect(h[0].userInputMessage.content).toBe('SYSTEM\n\nfix a.ts')
    expect(h[0].userInputMessage).toMatchObject({ modelId: 'claude-sonnet-4.5', origin: 'AI_EDITOR' })
    expect(h[0].userInputMessage.images).toBeUndefined() // images only on the current turn
    expect(h[1].assistantResponseMessage.content).toBe('(empty placeholder)')
    const longName = h[1].assistantResponseMessage.toolUses[1].name
    expect(longName.length).toBeLessThanOrEqual(64)
    expect(toolNames.get(longName)).toBe('mcp__very_long_server_name_for_testing__and_an_even_longer_tool_name_here')
    // Tool results + the following user text share one user turn.
    expect(h[2].userInputMessage.content).toBe('[auto_verify] typecheck failed')
    expect(h[2].userInputMessage.userInputMessageContext.toolResults).toEqual([
      { toolUseId: 't1', content: [{ text: 'export const a = 1' }], status: 'success' },
      { toolUseId: 't2', content: [{ text: 'boom' }], status: 'error' }
    ])
    expect(h[2].userInputMessage.userInputMessageContext.tools).toBeUndefined()
    const cur = cs.currentMessage.userInputMessage
    expect(cur.content).toBe('Tool results provided.')
    expect(cur.images).toEqual([{ format: 'png', source: { bytes: 'iVBORw0KGgo=' } }])
    expect(cur.userInputMessageContext.toolResults[0].content[0].text).toBe('screenshot 2x2')
    const spec = cur.userInputMessageContext.tools[0].toolSpecification
    expect(spec).toEqual({ name: 'read_file', description: 'read_file tool', inputSchema: { json: { type: 'object', properties: { path: { type: 'string' } } } } })
  })

  it('turns orphan tool results into text and handles tool-less requests', () => {
    const orphan: TranscriptEntry[] = [
      { role: 'summary', content: 'earlier work' },
      { role: 'tool', toolCallId: 'gone', name: 'read_file', content: 'stale result' },
      { role: 'user', content: 'continue' }
    ]
    const { body } = buildKiroRequest({ entries: orphan, systemText: '', tools: [tool('read_file')], modelId: 'auto', conversationId: 'c' })
    const cur = (body.conversationState as any).currentMessage.userInputMessage
    expect(cur.content).toContain('[tool result gone]\nstale result')
    expect(cur.content).toContain('[Summary of the earlier conversation]\nearlier work')
    expect(cur.userInputMessageContext.toolResults).toBeUndefined()
    const noTools = buildKiroRequest({ entries, systemText: '', tools: [], modelId: 'auto', conversationId: 'c' })
    const json = JSON.stringify(noTools.body)
    expect(json).not.toContain('toolUses')
    expect(json).not.toContain('toolResults')
    expect(json).toContain('[called read_file')
  })

  it('trims the oldest turns to fit the payload limit, keeping a valid conversation', () => {
    const big: TranscriptEntry[] = []
    for (let i = 0; i < 30; i++) {
      big.push({ role: 'user', content: `q${i} ${'x'.repeat(4000)}` })
      big.push({ role: 'assistant', content: '', toolCalls: [{ id: `c${i}`, name: 'read_file', arguments: {} }] })
      big.push({ role: 'tool', toolCallId: `c${i}`, name: 'read_file', content: 'y'.repeat(4000) })
    }
    big.push({ role: 'user', content: 'final question' })
    const r = buildKiroRequest({ entries: big, systemText: 'SYS', tools: [tool('read_file')], modelId: 'auto', conversationId: 'c', maxBytes: 60_000 })
    expect(new TextEncoder().encode(JSON.stringify(r.body)).length).toBeLessThanOrEqual(60_000)
    expect(r.trimmedTurns).toBeGreaterThan(0)
    const h = (r.body.conversationState as any).history as Array<Record<string, any>>
    expect(Object.keys(h[0])[0]).toBe('userInputMessage')
    expect(h[0].userInputMessage.content).toMatch(/^SYS\n\n\[\d+ earlier messages omitted/)
    for (let i = 0; i < h.length; i++) expect(Object.keys(h[i])[0]).toBe(i % 2 === 0 ? 'userInputMessage' : 'assistantResponseMessage')
    expect((r.body.conversationState as any).currentMessage.userInputMessage.content).toContain('final question')
  })

  it('maps ids and sanitizes schemas', () => {
    expect(toKiroModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4.5')
    expect(toKiroModelId('claude-opus-5.5')).toBe('claude-opus-5.5')
    expect(toKiroModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4.5')
    expect(toKiroModelId('gpt-5.6-terra')).toBe('gpt-5.6-terra')
    expect(sanitizeSchema({ type: 'object', additionalProperties: false, required: [], properties: { a: { type: 'object', additionalProperties: true, required: ['b'] } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'object', required: ['b'] } }
    })
    const id = kiroConversationId('session-1')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(kiroConversationId('session-1')).toBe(id)
    expect(kiroConversationId('session-2')).not.toBe(id)
  })

  it('merges Kiro catalogs without list prices, with authoritative vision flags', () => {
    const r = mergeRemoteModels([], 'kiro', [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · 1.3x', contextWindow: 1_000_000, supportsVision: true }, { id: 'glm-5', label: 'GLM 5', supportsVision: false }], { noPricing: true })
    expect(r.models.map((m) => [m.modelId, m.pricing, m.supportsVision, m.contextWindow])).toEqual([
      ['claude-sonnet-5', undefined, true, 1_000_000],
      ['glm-5', undefined, false, undefined]
    ])
  })
})

describe('callLLM over the Kiro bridge', () => {
  let listener: ((d: { requestId: string; event: any }) => void) | null = null
  let started: { id: string; body: Record<string, any> } | null = null
  let script: any[] = []

  beforeEach(() => {
    listener = null
    started = null
    ;(window as any).api = {
      platform: 'darwin',
      kiro: {
        onEvent: (cb: typeof listener) => {
          listener = cb
          return () => (listener = null)
        },
        chatStart: vi.fn(async (id: string, body: Record<string, any>) => {
          started = { id, body }
          setTimeout(() => {
            for (const ev of script) listener?.({ requestId: 'other', event: { type: 'text', text: 'NOT MINE' } })
            for (const ev of script) listener?.({ requestId: id, event: ev })
          }, 5)
          return { ok: true }
        }),
        chatAbort: vi.fn(async () => ({ ok: true }))
      }
    }
    useProviderStore.setState({ agentMode: 'build', sessionAgentModes: {}, nativeCodingTools: true } as any)
  })

  const decision = () =>
    ({
      provider: { id: 'kiro', name: 'Kiro', apiFormat: 'kiro', baseUrl: 'https://q.us-east-1.amazonaws.com', enabled: true },
      model: { id: 'kiro:sonnet', providerId: 'kiro', modelId: 'claude-sonnet-5', label: 'Sonnet', tier: 'mid', enabled: true, contextWindow: 200_000 },
      key: 'kiro:claude-sonnet-5',
      tier: 'mid',
      reason: 'test'
    }) as any

  const req = (extra: Record<string, unknown> = {}) => ({
    decision: decision(),
    entries: [{ role: 'user', content: 'hello' }] as TranscriptEntry[],
    systemLayers: ['SYS'],
    projectPreamble: 'PRE',
    sessionId: 's1',
    projectId: 'p1',
    assistantMsgId: 'm1',
    signal: new AbortController().signal,
    ...extra
  })

  it('streams text and tool calls, and estimates usage from context percentage', async () => {
    script = [
      { type: 'text', text: 'Reading ' },
      { type: 'text', text: 'it.' },
      { type: 'toolUse', id: 'tu1', name: 'read_file', input: { path: 'a.ts' } },
      { type: 'usage', contextUsagePercentage: 5 },
      { type: 'usage', credits: 0.01 },
      { type: 'done' }
    ]
    const seen: string[] = []
    const res = await callLLM(req({ onToolCall: (c: { id: string }) => seen.push(c.id) }) as any)
    expect(res.text).toBe('Reading it.')
    expect(res.toolCalls).toEqual([{ id: 'tu1', name: 'read_file', arguments: { path: 'a.ts' } }])
    expect(seen).toEqual(['tu1'])
    expect(res.usage.inputTokens).toBe(10_000)
    expect(res.usage.outputTokens).toBeGreaterThan(0)
    const cur = started!.body.conversationState.currentMessage.userInputMessage
    expect(cur.content.startsWith('SYS\n\nPRE')).toBe(true)
    expect(cur.content.endsWith('hello')).toBe(true)
    expect(cur.modelId).toBe('claude-sonnet-5')
    expect(cur.userInputMessageContext.tools.length).toBeGreaterThan(10)
  })

  it('raises Kiro errors with the transient flag for router failover', async () => {
    script = [{ type: 'error', message: 'Kiro API 429: throttled', transient: true }]
    await expect(callLLM(req() as any)).rejects.toMatchObject({ message: 'Kiro API 429: throttled', transient: true })
    script = [{ type: 'error', message: 'Kiro monthly credit limit reached', transient: false }]
    await expect(callLLM(req() as any)).rejects.toMatchObject({ transient: false })
  })

  it('aborts the main-process request on Stop', async () => {
    script = []
    const ctrl = new AbortController()
    const p = callLLM(req({ signal: ctrl.signal }) as any)
    await new Promise((r) => setTimeout(r, 20))
    ctrl.abort()
    await expect(p).rejects.toThrow()
    expect((window as any).api.kiro.chatAbort).toHaveBeenCalled()
  })

  it('gives GPT models on Kiro apply_patch instead of edit_file', async () => {
    script = [{ type: 'text', text: 'ok' }, { type: 'done' }]
    await callLLM(req({ decision: { ...decision(), model: { ...decision().model, modelId: 'gpt-5.6-terra' } } }) as any)
    const names = started!.body.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools.map((t: any) => t.toolSpecification.name)
    expect(names).toContain('apply_patch')
    expect(names).not.toContain('edit_file')
  })
})
