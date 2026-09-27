// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { executeTool } from '../toolExecutor'
import { activeToolGroups, groupOfTool, hiddenToolNames } from '../toolsets'
import { TOOLS } from '../toolDefinitions'
import { isToolAllowedInAgentMode } from '../agentMode'
import { TOOL_SAFETY } from '../toolPermission'
import { callLLM } from '../llm'
import { transcriptNote } from '../skillDrafting'
import { useProviderStore } from '../../stores/provider'
import { useAppStore } from '../../stores/app'

const save = vi.fn()

beforeEach(() => {
  save.mockReset()
  ;(window as any).api = { localSkills: { save, read: vi.fn() }, hooks: undefined, platform: 'darwin' }
  useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
})

describe('save_skill tool', () => {
  it('saves through the main process and tells the agent how to run it', async () => {
    save.mockResolvedValue({ ok: true, path: '/Users/me/.agents/skills/book-parking/SKILL.md', created: false })
    const changed = vi.fn()
    window.addEventListener('pawn:skills-changed', changed)
    const r = await executeTool({ id: 'c1', name: 'save_skill', arguments: { name: 'book-parking', content: '---\nname: book-parking\n---', overwrite: true } })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('Updated skill "book-parking"')
    expect(r.content).toContain('/book-parking')
    expect(save).toHaveBeenCalledWith('book-parking', '---\nname: book-parking\n---', { overwrite: true })
    expect(changed).toHaveBeenCalled()
    window.removeEventListener('pawn:skills-changed', changed)
  })

  it('asks the agent to confirm before replacing an existing skill', async () => {
    save.mockResolvedValue({ ok: false, error: 'A skill named "x" already exists', exists: true })
    const r = await executeTool({ id: 'c2', name: 'save_skill', arguments: { name: 'x', content: 'y' } })
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/overwrite:true/)
  })

  it('is a mutating, prompted tool that only loads when skills come up', () => {
    expect(TOOLS.some((t) => t.name === 'save_skill')).toBe(true)
    expect(TOOL_SAFETY.save_skill).toBe('risky')
    expect(isToolAllowedInAgentMode('save_skill', 'plan')).toBe(false)
    expect(groupOfTool('save_skill')?.id).toBe('skills')
    const all = TOOLS.map((t) => t.name)
    expect(hiddenToolNames({ entries: [{ role: 'user', content: 'fix the bug' }], allToolNames: all, connected: new Set() })).toContain('save_skill')
    // A recorded-workflow chat carries the note, so refinement works right away.
    expect(activeToolGroups([{ role: 'user', content: transcriptNote('🎬 Recorded a workflow') }]).has('skills')).toBe(true)
    expect(activeToolGroups([{ role: 'user', content: '이 스킬에서 날짜 입력은 빼줘' }]).has('skills')).toBe(true)
  })
})

describe('callLLM noTools', () => {
  it('sends no tools at all (drafting a skill is a plain completion)', async () => {
    useAppStore.setState({
      projects: [{ id: 'p1', name: 'P', paths: [], sessions: [{ id: 's1', title: 'S', path: '', createdAt: 1, messages: [] }] }]
    } as any)
    ;(window as any).api.db = { updateMessageContent: vi.fn().mockResolvedValue({ ok: true }) }
    const enc = new TextEncoder()
    const fetchMock = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'))
            c.close()
          }
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const base = {
      entries: [{ role: 'user' as const, content: 'hi' }],
      systemLayers: ['sys'],
      projectPreamble: '',
      sessionId: 's1',
      projectId: 'p1',
      assistantMsgId: 'a1',
      signal: new AbortController().signal,
      noTools: true
    }
    for (const apiFormat of ['openai', 'claude'] as const) {
      await callLLM({
        ...base,
        decision: {
          provider: { id: 'x', name: 'X', apiFormat, baseUrl: 'https://api.example.com/v1', apiKey: 'k', enabled: true },
          model: { id: 'x:m', providerId: 'x', modelId: 'm', label: 'M', tier: 'mid', enabled: true },
          key: 'x:m',
          tier: 'mid',
          reason: 'test'
        }
      } as any)
      const body = JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))
      expect(body.tools, apiFormat).toBeUndefined()
    }
  })
})
