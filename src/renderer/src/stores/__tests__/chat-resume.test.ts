// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadTranscript } from '../chat'
import { useProviderStore } from '../provider'
import { getSessionRoute, clearSessionRoute } from '../../agent/router'

const getTranscriptMock = vi.fn()

beforeEach(() => {
  ;(window as any).api = { db: { getTranscript: getTranscriptMock } }
  useProviderStore.setState({
    providers: [{ id: 'p1', name: 'P', apiFormat: 'openai', baseUrl: 'https://x', enabled: true }],
    models: [{ id: 'p1:m1', providerId: 'p1', modelId: 'm1', label: 'M1', tier: 'high', enabled: true }],
    routingMode: 'auto',
    activeModelId: null
  })
  getTranscriptMock.mockReset()
  clearSessionRoute('resume-session')
})

const transcript = (overrides: Record<string, unknown>): string => JSON.stringify({
  version: 2,
  entries: [{ role: 'user', content: 'hi' }],
  warmFor: 'p1:m1',
  lastActivity: Date.now(),
  ...overrides
})

describe('loadTranscript sticky restore', () => {
  it('restores the warm route within the cache TTL', async () => {
    getTranscriptMock.mockResolvedValue(transcript({}))
    await loadTranscript('proj', 'resume-session')

    const route = getSessionRoute('resume-session')
    expect(route?.key).toBe('p1:m1')
    expect(route?.tier).toBe('high')
    expect(route?.warmTokens).toBeGreaterThan(0)
  })

  it('uses the persisted warmTier even when it differs from the model tier', async () => {
    getTranscriptMock.mockResolvedValue(transcript({ warmTier: 'mid' }))
    await loadTranscript('proj', 'resume-session')
    expect(getSessionRoute('resume-session')?.tier).toBe('mid')
  })

  it('clears the route on a cold start', async () => {
    getTranscriptMock.mockResolvedValue(transcript({ lastActivity: Date.now() - 10 * 60 * 1000 }))
    await loadTranscript('proj', 'resume-session')
    expect(getSessionRoute('resume-session')).toBeUndefined()
  })

  it('skips restore when the warm model no longer exists', async () => {
    getTranscriptMock.mockResolvedValue(transcript({ warmFor: 'p1:deleted' }))
    await loadTranscript('proj', 'resume-session')
    expect(getSessionRoute('resume-session')).toBeUndefined()
  })
})
