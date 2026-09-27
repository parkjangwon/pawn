// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildAutomationPrompt,
  buildDraftSystemPrompt,
  buildDraftUserText,
  buildRunPrompt,
  extractSkillDraft,
  parseSkillInputs,
  sameSkill,
  splitSkillAnswer
} from '../recordReplay'

const SKILL = `---
name: file-phone-expense
description: File a monthly phone bill as an expense in Expensify. Use when the user wants to submit a phone bill.
---

# File a phone bill expense

## Inputs
- \`amount\` — bill total (required). Example from the recording: 42.50
- \`receipt_file\` — PDF of the bill (required). Example from the recording: "bill-sept.pdf"
- \`month\` — optional, defaults to last month

## Steps
1. Open https://expensify.example/new
2. Type the amount into **Amount**

## Verify
- A "Submitted" banner appears.
`

describe('extractSkillDraft', () => {
  it('reads a four-backtick skill block and its inputs', () => {
    const answer = `Here is the skill.\n\n\`\`\`\`skill\n${SKILL}\`\`\`\`\n\nI guessed the category.`
    const d = extractSkillDraft(answer)
    expect(d).toMatchObject({ name: 'file-phone-expense', description: expect.stringContaining('phone bill') })
    expect(d!.inputs).toEqual([
      expect.objectContaining({ name: 'amount', required: true, example: '42.50' }),
      expect.objectContaining({ name: 'receipt_file', required: true, example: 'bill-sept.pdf' }),
      expect.objectContaining({ name: 'month', required: false })
    ])
    const split = splitSkillAnswer(answer)
    expect(split?.before).toBe('Here is the skill.')
    expect(split?.after).toBe('I guessed the category.')
  })

  it('accepts three-backtick fences, bare documents and cut-off answers', () => {
    expect(extractSkillDraft('```skill\n' + SKILL + '```')?.name).toBe('file-phone-expense')
    expect(extractSkillDraft('Sure:\n' + SKILL)?.name).toBe('file-phone-expense')
    expect(extractSkillDraft('````skill\n' + SKILL.slice(0, 200))?.name).toBe('file-phone-expense')
    expect(extractSkillDraft('no skill here')).toBeNull()
  })

  it('fixes invalid names so the draft can be saved', () => {
    const bad = SKILL.replace('name: file-phone-expense', 'name: File Phone Expense!')
    const d = extractSkillDraft('````skill\n' + bad + '````')
    expect(d?.name).toBe('file-phone-expense')
    expect(d?.content).toMatch(/^---\nname: file-phone-expense\n/)
    const unnamed = SKILL.replace('name: file-phone-expense\n', '')
    expect(extractSkillDraft('````skill\n' + unnamed + '````')?.name).toBe('file-a-phone-bill-expense')
  })

  it('parses Korean input sections', () => {
    const ko = '## Inputs\n- `amount` — 청구 금액 (필수). 예시: 42,000원\n- `memo` — 메모 (선택)\n\n## Steps\n1. x'
    expect(parseSkillInputs(ko)).toEqual([
      expect.objectContaining({ name: 'amount', required: true, example: '42,000원' }),
      expect.objectContaining({ name: 'memo', required: false })
    ])
    expect(parseSkillInputs('## Inputs\n- none\n')).toEqual([])
  })
})

describe('prompts', () => {
  const bundle: RecordingBundleDto = {
    id: 'rec-1',
    context: {},
    goal: 'File the phone bill',
    inputsHint: 'amount, receipt',
    startedAt: 0,
    durationMs: 84_000,
    sources: ['browser', 'desktop'],
    steps: [{ index: 1, t: 0, source: 'browser', kind: 'navigate', context: 'Pawn browser · exp.co', text: 'Open https://exp.co' }],
    stepsText: '1. (00:00) [Pawn browser · exp.co] Open https://exp.co',
    frames: [{ t: 1, source: 'browser', dataUrl: 'data:image/jpeg;base64,AA', width: 1, height: 1, step: 1 }],
    stats: { events: 3, steps: 1, framesCaptured: 2, truncated: false, stopReason: 'user' },
    notes: ['No screenshots of Mac apps.']
  }

  it('builds the drafting request from the bundle', () => {
    const text = buildDraftUserText(bundle)
    expect(text).toContain('Goal (from the user): File the phone bill')
    expect(text).toContain('Pawn browser + Mac apps · 1m 24s · 1 steps')
    expect(text).toContain('Recorder notes: No screenshots of Mac apps.')
    expect(text).toContain('#1 Pawn browser after step 1')
    expect(buildDraftSystemPrompt('ko-KR')).toContain('in Korean')
    expect(buildDraftSystemPrompt('fr')).toContain('in English')
    expect(buildDraftSystemPrompt('en')).toContain('````skill')
  })

  it('builds run and automation prompts', () => {
    const inputs = parseSkillInputs(SKILL)
    expect(buildRunPrompt('file-phone-expense', inputs, { amount: '12', month: ' ' }, 'ko')).toBe('/file-phone-expense 이 스킬대로 실행해줘.\n\n- amount: 12')
    const auto = buildAutomationPrompt('file-phone-expense', inputs, { amount: '12' })
    expect(auto).toContain('Load the skill "file-phone-expense" with load_skill')
    expect(auto).toContain('- amount: 12')
    expect(auto).toContain('- receipt_file: <e.g. bill-sept.pdf>')
    expect(auto).toContain('scheduled run')
    expect(sameSkill('a\r\nb  \n', 'a\nb')).toBe(true)
  })
})

// --- Pipeline: finished recording → chat draft (real callLLM, mocked network) ---

import { useAppStore } from '../../stores/app'
import { useProviderStore } from '../../stores/provider'
import { useChatStore } from '../../stores/chat'
import { useRecordingStore, __pendingBundleCount } from '../../stores/recording'
import '../../i18n'

function sse(text: string): Response {
  const enc = new TextEncoder()
  const chunks = [text.slice(0, 40), text.slice(40)].map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
  chunks.push('data: {"usage":{"prompt_tokens":900,"completion_tokens":300}}\n\n', 'data: [DONE]\n\n')
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      }
    }),
    { status: 200 }
  )
}

const ANSWER = `Drafted from your recording.\n\n\`\`\`\`skill\n${SKILL}\`\`\`\`\n\nCheck the category.`
let emit: ((ev: RecorderEventDto) => void) | null = null
const saveTranscript = vi.fn().mockResolvedValue({ ok: true })

function bundle(over: Partial<RecordingBundleDto> = {}): RecordingBundleDto {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    context: { projectId: 'p1', sessionId: 's1' },
    goal: 'File the phone bill',
    inputsHint: 'amount',
    startedAt: 0,
    durationMs: 30_000,
    sources: ['browser'],
    steps: [
      { index: 1, t: 0, source: 'browser', kind: 'navigate', context: 'Pawn browser · exp.co', text: 'Open https://exp.co/new' },
      { index: 2, t: 900, source: 'browser', kind: 'input', context: 'Pawn browser · exp.co', text: 'Type "UNIQUE-VALUE-42" into text field "Amount"' }
    ],
    stepsText: '1. Open https://exp.co/new\n2. Type "UNIQUE-VALUE-42" into text field "Amount"',
    frames: [{ t: 10, source: 'browser', dataUrl: 'data:image/jpeg;base64,SCREENSHOT', width: 10, height: 10, step: 2 }],
    stats: { events: 5, steps: 2, framesCaptured: 1, truncated: false, stopReason: 'user' },
    notes: [],
    ...over
  }
}

beforeEach(() => {
  emit = null
  saveTranscript.mockClear()
  vi.stubGlobal('fetch', vi.fn())
  ;(window as any).api = {
    platform: 'darwin',
    recorder: {
      status: vi.fn().mockResolvedValue({ state: 'idle' }),
      readiness: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      openPermissions: vi.fn(),
      onEvent: (cb: (ev: RecorderEventDto) => void) => {
        emit = cb
        return () => (emit = null)
      }
    },
    db: {
      addMessage: vi.fn().mockResolvedValue({ ok: true }),
      addSession: vi.fn().mockResolvedValue({ ok: true }),
      updateSessionTitle: vi.fn().mockResolvedValue({ ok: true }),
      updateMessageContent: vi.fn().mockResolvedValue({ ok: true }),
      updateMessageMeta: vi.fn().mockResolvedValue({ ok: true }),
      deleteMessage: vi.fn().mockResolvedValue({ ok: true }),
      getTranscript: vi.fn().mockResolvedValue(JSON.stringify({ version: 2, entries: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }], warmFor: '', lastActivity: Date.now() })),
      saveTranscript,
      getMessages: vi.fn().mockResolvedValue([]),
      addUsage: vi.fn().mockResolvedValue({ ok: true })
    },
    setSessionStreaming: vi.fn()
  }
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'P', paths: [], sessions: [{ id: 's1', title: 'S', path: '', createdAt: 1, messages: [] }] }],
    activeProjectId: 'p1',
    activeSessionId: 's1',
    loadedSessions: new Set(['s1'])
  })
  useProviderStore.setState({
    providers: [{ id: 'op', name: 'OpenAI', apiFormat: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', enabled: true }],
    models: [{ id: 'op:gpt', providerId: 'op', modelId: 'gpt-4o', label: 'GPT-4o', tier: 'mid', enabled: true, supportsVision: true }],
    routingMode: 'auto'
  } as any)
  useChatStore.setState({ streamingSessionIds: [], isStreaming: false, queue: [] } as any)
  useRecordingStore.setState({ status: { state: 'idle' }, jobs: {}, error: null })
  useRecordingStore.getState().init()
})

describe('recording → skill draft pipeline', () => {
  it('drafts into the chat with screenshots and no tools, and keeps no raw recording', async () => {
    vi.mocked(fetch).mockResolvedValue(sse(ANSWER))
    expect(emit).toBeTypeOf('function')
    emit!({ type: 'finished', bundle: bundle() })
    await vi.waitFor(() => expect(saveTranscript).toHaveBeenCalled())
    await vi.waitFor(() => expect(Object.keys(useRecordingStore.getState().jobs)).toHaveLength(0))

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.tools).toBeUndefined()
    expect(body.messages[0].content).toContain('Agent Skill')
    const user = body.messages.find((m: any) => m.role === 'user')
    expect(JSON.stringify(user.content)).toContain('data:image/jpeg;base64,SCREENSHOT')
    expect(JSON.stringify(user.content)).toContain('UNIQUE-VALUE-42')

    const msgs = useAppStore.getState().projects[0].sessions[0].messages
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0].content).toMatch(/^🎬 /)
    expect(msgs[0].content).not.toContain('UNIQUE-VALUE-42')
    expect(msgs[1].content).toContain('````skill')

    await vi.waitFor(() => expect(saveTranscript).toHaveBeenCalled())
    const stored = String(saveTranscript.mock.calls[saveTranscript.mock.calls.length - 1][1])
    expect(stored).toContain('earlier')
    expect(stored).toContain('file-phone-expense')
    expect(stored).not.toContain('SCREENSHOT')
    expect(stored).not.toContain('UNIQUE-VALUE-42')
    expect(__pendingBundleCount()).toBe(0)
    expect(useChatStore.getState().streamingSessionIds).not.toContain('s1')
  })

  it('keeps the recording in memory after a failure so it can be retried, then drops it', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":{"message":"bad request"}}', { status: 400 }))
    const b = bundle()
    emit!({ type: 'finished', bundle: b })
    await vi.waitFor(() => expect(useRecordingStore.getState().jobs[b.id]?.state).toBe('failed'))
    expect(useRecordingStore.getState().jobs[b.id]?.error).toMatch(/bad request|400/)
    expect(__pendingBundleCount()).toBe(1)
    expect(useAppStore.getState().projects[0].sessions[0].messages).toHaveLength(0)

    vi.mocked(fetch).mockResolvedValue(sse(ANSWER))
    await useRecordingStore.getState().retry(b.id)
    expect(useRecordingStore.getState().jobs[b.id]).toBeUndefined()
    expect(__pendingBundleCount()).toBe(0)
    expect(useAppStore.getState().projects[0].sessions[0].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('reports an empty recording without calling a model', async () => {
    emit!({ type: 'finished', bundle: bundle({ steps: [], stepsText: '' }) })
    expect(useRecordingStore.getState().error).toMatch(/Nothing was recorded/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('drafts into a new chat when the original chat is busy', async () => {
    vi.mocked(fetch).mockResolvedValue(sse(ANSWER))
    useChatStore.setState({ streamingSessionIds: ['s1'] } as any)
    emit!({ type: 'finished', bundle: bundle() })
    await vi.waitFor(() => expect(useAppStore.getState().projects[0].sessions).toHaveLength(2))
    await vi.waitFor(() => expect(saveTranscript).toHaveBeenCalled())
    await vi.waitFor(() => expect(Object.keys(useRecordingStore.getState().jobs)).toHaveLength(0))
    const fresh = useAppStore.getState().projects[0].sessions[1]
    expect(fresh.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(useAppStore.getState().activeSessionId).toBe(fresh.id)
  })
})
