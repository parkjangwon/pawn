/**
 * Hermetic agentLoop smoke tests — no live LLM, no filesystem, no Electron.
 *
 * The loop's two network touchpoints are mocked (`route`, `callLLM`) and the
 * Zustand stores are seeded directly, so the real loop body runs: preamble,
 * round execution, transcription into the session, and the finally teardown
 * that must always clear the streaming flags.
 *
 * This harness exists so the loop body stops being a no-go zone for
 * refactoring: regressions here ship silently today.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const harness = vi.hoisted(() => ({
  callLLM: vi.fn(),
  route: vi.fn()
}))

vi.mock('../../agent/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/llm')>()),
  callLLM: harness.callLLM
}))
vi.mock('../../agent/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/router')>()),
  route: harness.route
}))

import { agentLoop } from '../chatLoop'
import { useChatStore } from '../chat'
import { useAppStore } from '../app'
import { useProviderStore } from '../provider'

const fakeDecision = {
  provider: { id: 'fake' } as never,
  model: {
    providerId: 'fake',
    modelId: 'fake-1',
    label: 'Fake 1',
    pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  } as never,
  key: 'fake:fake-1',
  tier: 'low' as const,
  reason: 'test'
}

function finalAnswer(text: string): unknown {
  return {
    text,
    toolCalls: [],
    thinking: [],
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    reasoningContent: undefined
  }
}

function seedProject(): void {
  useAppStore.setState({
    initialized: true,
    activeProjectId: 'p1',
    activeSessionId: 's1',
    projects: [
      {
        id: 'p1',
        name: 'P',
        paths: [],
        sessions: [{ id: 's1', title: 'T', path: '', createdAt: Date.now(), messages: [] }]
      }
    ]
  })
}

function seedProvider(): void {
  useProviderStore.setState({
    providers: [
      { id: 'fake', name: 'Fake', baseUrl: 'https://fake.test', apiKey: 'k', enabled: true }
    ] as never,
    models: [
      {
        providerId: 'fake',
        modelId: 'fake-1',
        label: 'Fake 1',
        enabled: true,
        pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ] as never
  })
}

function sessionMessages() {
  return useAppStore.getState().projects[0].sessions[0].messages
}

beforeEach(() => {
  vi.clearAllMocks()
  seedProject()
  useChatStore.setState({
    isStreaming: false,
    streamingSessionId: null,
    streamingSessionIds: [],
    queue: []
  })
  useProviderStore.setState({ providers: [], models: [] })
  // route() is synchronous in the real router.
  harness.route.mockReturnValue(fakeDecision)
  // The real callLLM streams into the assistant bubble; the loop only keeps
  // a response it considers "displayed". Mimic the streaming contract.
  harness.callLLM.mockImplementation(async (req: { projectId: string; sessionId: string; assistantMsgId: string }) => {
    useAppStore.getState().updateMessageContent(req.projectId, req.sessionId, req.assistantMsgId, 'Hello')
    return finalAnswer('Hello')
  })
})

describe('agentLoop (hermetic smoke)', () => {
  it('answers noProvider and never calls the LLM when no provider is enabled', async () => {
    const set = useChatStore.setState
    const get = useChatStore.getState
    await agentLoop('p1', 's1', 'hi', set, get)
    expect(harness.callLLM).not.toHaveBeenCalled()
    // systemError reports through an assistant bubble.
    expect(sessionMessages().some((m) => m.role === 'assistant' && m.content.trim())).toBe(true)
    expect(useChatStore.getState().isSessionStreaming('s1')).toBe(false)
  })

  it('runs a happy turn: LLM answer lands in the session and flags clear', async () => {
    seedProvider()
    const set = useChatStore.setState
    const get = useChatStore.getState
    await agentLoop('p1', 's1', 'say hi', set, get)
    expect(harness.route).toHaveBeenCalledTimes(1)
    expect(harness.callLLM).toHaveBeenCalledTimes(1)
    // User text goes to the transcript, the answer lands as a UI assistant bubble.
    const lastAssistant = [...sessionMessages()].reverse().find((m) => m.role === 'assistant')
    expect(lastAssistant?.content).toBe('Hello')
    expect(useChatStore.getState().isSessionStreaming('s1')).toBe(false)
  })

  it('marks the turn failed but still clears streaming flags when the LLM throws', async () => {
    seedProvider()
    harness.callLLM.mockRejectedValue(Object.assign(new Error('HTTP 500: boom'), { transient: true }))
    const set = useChatStore.setState
    const get = useChatStore.getState
    await agentLoop('p1', 's1', 'break', set, get)
    // The router only has one model, so the failed model is not re-run.
    expect(harness.callLLM).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().isSessionStreaming('s1')).toBe(false)
    const lastMsg = [...sessionMessages()].reverse().find((m) => m.role === 'assistant')
    expect(lastMsg?.content).toContain('All model attempts failed')
    expect(lastMsg?.content).not.toContain('fallbacks also failed')
  })

  it('does not re-run an already-failed model when the router returns it again (429)', async () => {
    seedProvider()
    harness.callLLM.mockRejectedValue(Object.assign(new Error('HTTP 429: slow down'), { transient: true }))
    await agentLoop('p1', 's1', 'break', useChatStore.setState, useChatStore.getState)
    expect(harness.callLLM).toHaveBeenCalledTimes(1)
    const lastMsg = [...sessionMessages()].reverse().find((m) => m.role === 'assistant')
    expect(lastMsg?.error?.kind).toBe('rate')
  })

  it('classifies the first model error when a later fallback fails differently', async () => {
    useProviderStore.setState({
      providers: [
        { id: 'p1', name: 'P1', baseUrl: 'https://p1.test', apiKey: 'bad', enabled: true },
        { id: 'p2', name: 'P2', baseUrl: 'https://p2.test', apiKey: 'k', enabled: true }
      ] as never,
      models: [
        {
          providerId: 'p1', modelId: 'a', label: 'Model A', enabled: true,
          pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        },
        {
          providerId: 'p2', modelId: 'b', label: 'Model B', enabled: true,
          pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }
      ] as never
    })
    const dec = (providerId: string, modelId: string, label: string) => ({
      provider: { id: providerId } as never,
      model: {
        providerId, modelId, label,
        pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      } as never,
      key: `${providerId}:${modelId}`,
      tier: 'low' as const,
      reason: 'test'
    })
    let n = 0
    harness.route.mockImplementation(() => (n++ === 0 ? dec('p1', 'a', 'Model A') : dec('p2', 'b', 'Model B')))
    const missing = `HTTP 404: ${'not-found '.repeat(30)}`
    harness.callLLM.mockImplementation(async (req: { decision: { model: { modelId: string } } }) => {
      if (req.decision.model.modelId === 'a') {
        throw Object.assign(new Error('HTTP 401: bad key'), { transient: false })
      }
      throw Object.assign(new Error(missing), { transient: false })
    })
    await agentLoop('p1', 's1', 'break', useChatStore.setState, useChatStore.getState)
    const lastMsg = [...sessionMessages()].reverse().find((m) => m.role === 'assistant')
    expect(lastMsg?.error?.kind).toBe('auth')
    expect(lastMsg?.content).toContain('401')
    expect(lastMsg?.content).toContain('Model A: HTTP 401: bad key')
    expect(lastMsg?.content).toContain(`last: Model B: ${missing.slice(0, 200)}`)
    expect(lastMsg?.content).not.toContain(missing)
  })

  it('reports provider errors when routing runs out of models after failures', async () => {
    const model = (providerId: string, modelId: string, label: string) => ({
      providerId, modelId, label, enabled: true,
      pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    })
    useProviderStore.setState({
      providers: [
        { id: 'p1', name: 'P1', baseUrl: 'https://p1.test', apiKey: 'bad', enabled: true },
        { id: 'p2', name: 'P2', baseUrl: 'https://p2.test', apiKey: 'k', enabled: true }
      ] as never,
      models: [model('p1', 'a', 'Model A'), model('p2', 'b', 'Model B')] as never
    })
    const dec = (providerId: string, modelId: string, label: string) => ({
      provider: { id: providerId } as never,
      model: model(providerId, modelId, label) as never,
      key: `${providerId}:${modelId}`,
      tier: 'low' as const,
      reason: 'test'
    })
    let n = 0
    harness.route.mockImplementation(() => {
      const i = n++
      return i === 0 ? dec('p1', 'a', 'Model A') : i === 1 ? dec('p2', 'b', 'Model B') : null
    })
    harness.callLLM.mockImplementation(async (req: { decision: { model: { modelId: string } } }) => {
      throw Object.assign(new Error(req.decision.model.modelId === 'a' ? 'HTTP 401: bad key' : 'HTTP 404: missing'), { transient: false })
    })
    await agentLoop('p1', 's1', 'break', useChatStore.setState, useChatStore.getState)
    const lastMsg = [...sessionMessages()].reverse().find((m) => m.role === 'assistant')
    expect(lastMsg?.error?.kind).toBe('auth')
    expect(lastMsg?.content).toContain('All model attempts failed')
    expect(lastMsg?.content).not.toContain('No usable model')
  })
})
