// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import QuestionCard from '../QuestionCard'
import {
  __resetQuestionsForTests,
  formatAnswerForModel,
  useQuestionStore
} from '../../stores/userQuestions'
import { executeTool } from '../../agent/toolExecutor'
import { useProviderStore } from '../../stores/provider'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  __resetQuestionsForTests()
  ;(window as any).api = { notification: { send: vi.fn().mockResolvedValue(undefined) } }
  useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
})

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('question store', () => {
  it('resolves with the answer and removes the pending question', async () => {
    const p = useQuestionStore.getState().ask({
      sessionId: 's1',
      kind: 'question',
      question: 'Which DB?',
      options: [{ label: 'SQLite' }, { label: 'Postgres' }],
      multiSelect: false,
      allowOther: true
    })
    const q = useQuestionStore.getState().pending[0]
    expect(useQuestionStore.getState().forSession('s1')?.id).toBe(q.id)
    useQuestionStore.getState().answer(q.id, { selected: ['Postgres'] })
    await expect(p).resolves.toEqual({ selected: ['Postgres'] })
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })

  it('aborts when the turn is stopped', async () => {
    const controller = new AbortController()
    const p = useQuestionStore.getState().ask(
      { sessionId: 's1', kind: 'question', question: 'Q?', options: [], multiSelect: false, allowOther: true },
      controller.signal
    )
    controller.abort()
    await expect(p).resolves.toMatchObject({ aborted: true })
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })

  it('formats answers for the model', () => {
    const q = { kind: 'question' as const, options: [] }
    expect(formatAnswerForModel(q, { selected: ['A'] })).toBe('The user chose: A')
    expect(formatAnswerForModel(q, { selected: ['A', 'B'], text: 'both' })).toContain('"A", "B"')
    expect(formatAnswerForModel(q, { selected: [], text: 'custom' })).toBe('The user answered: custom')
    expect(formatAnswerForModel(q, { selected: [], dismissed: true })).toContain('dismissed')
  })
})

describe('ask_user tool + QuestionCard', () => {
  it('shows the question, answers with one click, and returns the choice to the agent', async () => {
    render(<QuestionCard sessionId="s1" />)
    const run = executeTool(
      {
        id: 'c1',
        name: 'ask_user',
        arguments: {
          question: 'Which package manager?',
          options: [{ label: 'pnpm', description: 'Workspace-native' }, { label: 'npm' }, 'npm']
        }
      },
      undefined,
      undefined,
      { sessionId: 's1' }
    )
    await flush()
    expect(screen.getByText('Which package manager?')).toBeInTheDocument()
    // Duplicate "npm" option collapsed.
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText('Workspace-native')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /pnpm/ }))
    const result = await run
    expect(result.content).toBe('The user chose: pnpm')
    expect(screen.queryByText('Which package manager?')).not.toBeInTheDocument()
  })

  it('supports number keys and free-text answers', async () => {
    render(<QuestionCard sessionId="s1" />)
    const run = executeTool(
      { id: 'c2', name: 'ask_user', arguments: { question: 'Name?', options: ['alpha', 'beta'] } },
      undefined,
      undefined,
      { sessionId: 's1' }
    )
    await flush()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: '2' })
    expect((await run).content).toBe('The user chose: beta')

    const run2 = executeTool(
      { id: 'c3', name: 'ask_user', arguments: { question: 'Anything else?' } },
      undefined,
      undefined,
      { sessionId: 's1' }
    )
    await flush()
    const box = screen.getByPlaceholderText('Type your answer…')
    fireEvent.change(box, { target: { value: 'ship it' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect((await run2).content).toBe('The user answered: ship it')
  })

  it('refuses to block inside subagents', async () => {
    const r = await executeTool(
      { id: 'c4', name: 'ask_user', arguments: { question: 'Q?' } },
      undefined,
      undefined,
      { sessionId: 's1', subagent: true }
    )
    expect(r.isError).toBe(true)
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })
})

describe('request_plan_approval', () => {
  beforeEach(() => {
    useProviderStore.getState().setAgentMode('plan', 's1')
  })

  it('is callable in Plan mode and switches the session to Build on approval', async () => {
    render(<QuestionCard sessionId="s1" />)
    const run = executeTool(
      { id: 'p1', name: 'request_plan_approval', arguments: { plan: '1. Edit router\n2. Add tests' } },
      undefined,
      undefined,
      { sessionId: 's1' }
    )
    await flush()
    expect(screen.getByText('Edit router')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve & build' }))
    const r = await run
    expect(r.content).toContain('Plan approved')
    expect(useProviderStore.getState().agentModeFor('s1')).toBe('build')
  })

  it('stays in Plan mode and relays feedback when changes are requested', async () => {
    render(<QuestionCard sessionId="s1" />)
    const run = executeTool(
      { id: 'p2', name: 'request_plan_approval', arguments: { plan: 'Rewrite everything' } },
      undefined,
      undefined,
      { sessionId: 's1' }
    )
    await flush()
    fireEvent.change(screen.getByPlaceholderText('Optional notes, or what to change…'), {
      target: { value: 'too risky, keep the API' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    const r = await run
    expect(r.content).toContain('too risky, keep the API')
    expect(useProviderStore.getState().agentModeFor('s1')).toBe('plan')
  })
})
