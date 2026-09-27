// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '../../i18n'
import SkillDraftCard from '../SkillDraftCard'
import RecordingBar from '../RecordingBar'
import MessageList from '../MessageList'
import { extractSkillDraft } from '../../agent/recordReplay'
import { useAutomationDraftStore } from '../../stores/automationDraft'
import { useRecordingStore } from '../../stores/recording'

const SKILL = `---
name: book-parking
description: Book a parking spot for a given day in the office parking portal.
---

# Book parking

## Inputs
- \`date\` — the day to book (required). Example: 2026-10-02

## Steps
1. Open the portal
`
const draft = extractSkillDraft('````skill\n' + SKILL + '````')!

let saved: string | null = null
const save = vi.fn(async (name: string, content: string, opts?: { overwrite?: boolean }) => {
  if (saved !== null && !opts?.overwrite) return { ok: false as const, error: 'exists', exists: true }
  saved = content
  return { ok: true as const, path: `/Users/me/.agents/skills/${name}/SKILL.md`, created: true }
})

beforeEach(() => {
  saved = null
  save.mockClear()
  ;(window as any).api = {
    platform: 'darwin',
    fs: { readFile: vi.fn(), listDir: vi.fn(), homeDir: vi.fn() },
    localSkills: {
      save,
      read: vi.fn(async (name: string) =>
        saved !== null ? { ok: true, path: `/Users/me/.agents/skills/${name}/SKILL.md`, content: saved } : { ok: false, error: 'none' }
      )
    }
  }
})

describe('SkillDraftCard', () => {
  it('saves a new draft and shows where it went', async () => {
    const changed = vi.fn()
    window.addEventListener('pawn:skills-changed', changed)
    render(<SkillDraftCard draft={draft} projectId="p1" />)
    expect(await screen.findByText('Draft')).toBeTruthy()
    expect(screen.getByText('book-parking')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }))
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.getByText('/Users/me/.agents/skills/book-parking/SKILL.md')).toBeTruthy()
    expect(save).toHaveBeenCalledWith('book-parking', draft.content, { overwrite: false })
    expect(changed).toHaveBeenCalled()
    window.removeEventListener('pawn:skills-changed', changed)
  })

  it('asks before replacing a different saved skill', async () => {
    saved = '---\nname: book-parking\ndescription: old version of the skill\n---\n'
    render(<SkillDraftCard draft={draft} />)
    expect(await screen.findByText('Differs from saved skill')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update saved skill' }))
    expect(await screen.findByText('Replace book-parking?')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Update saved skill' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('book-parking', draft.content, { overwrite: true }))
  })

  it('asks for inputs, then puts a /skill prompt in the composer', async () => {
    saved = draft.content
    const prefill = vi.fn()
    window.addEventListener('pawn:composer-prefill', (e) => prefill((e as CustomEvent).detail.text))
    render(<SkillDraftCard draft={draft} />)
    expect(await screen.findByText('Saved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run it' }))
    fireEvent.change(await screen.findByLabelText(/date/), { target: { value: '2026-10-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'Put in the message box' }))
    await waitFor(() => expect(prefill).toHaveBeenCalledWith('/book-parking Run this skill.\n\n- date: 2026-10-09'))
  })

  it('opens an automation draft that loads the skill', async () => {
    saved = draft.content
    const open = vi.fn()
    window.addEventListener('pawn:open-automations', open)
    render(<SkillDraftCard draft={draft} projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Automate' }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    const seed = useAutomationDraftStore.getState().take()
    expect(seed).toMatchObject({ projectId: 'p1', name: 'Book parking' })
    expect(seed?.prompt).toContain('load_skill')
  })
})

describe('skill drafts in messages', () => {
  it('renders the SKILL.md block of an assistant message as a card', async () => {
    const content = 'Here you go.\n\n````skill\n' + SKILL + '````\n\nCheck the date format.'
    render(
      <MessageList
        messages={[{ id: 'a1', role: 'assistant', content, createdAt: Date.now() }]}
        isStreaming={false}
        endRef={{ current: null }}
        startIndex={0}
        nearTop={false}
        onShowEarlier={() => {}}
        onScroll={() => {}}
        scrollRef={() => {}}
        sessionKey="s1"
        projectId="p1"
        sessionId="s1"
      />
    )
    expect(await screen.findByRole('group', { name: 'Skill book-parking' })).toBeTruthy()
    expect(screen.getByText('Here you go.')).toBeTruthy()
    expect(screen.getByText('Check the date format.')).toBeTruthy()
    // The raw front matter is not dumped as a code block.
    expect(screen.queryByText(/^name: book-parking/)).toBeNull()
  })
})

describe('RecordingBar', () => {
  beforeEach(() => {
    useRecordingStore.setState({ supported: true, setupOpen: true, status: { state: 'idle' }, jobs: {}, error: null, readiness: null, starting: false, setupTarget: { projectId: 'p1', sessionId: 's1' } })
  })

  it('starts a recording with the goal, hint and chosen sources', async () => {
    const start = vi.fn(async () => ({ ok: true, status: { state: 'recording', startedAt: Date.now(), steps: 0, sources: ['browser'] } }))
    ;(window as any).api.recorder = {
      readiness: vi.fn(async () => ({ platform: 'darwin', desktop: { supported: true, accessibility: false, screenRecording: false } })),
      start,
      openPermissions: vi.fn()
    }
    useRecordingStore.getState().openSetup({ projectId: 'p1', sessionId: 's1' })
    render(<RecordingBar sessionId="s1" />)
    // Mac apps needs Accessibility: unticked and disabled, with a shortcut to the setting.
    const desktop = (await screen.findByRole('checkbox', { name: /Mac apps/ })) as HTMLInputElement
    await waitFor(() => expect(desktop.disabled).toBe(true))
    expect(desktop.checked).toBe(false)
    expect(screen.getByRole('button', { name: 'Open Accessibility settings' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('What will you show?'), { target: { value: 'Book parking for Friday' } })
    fireEvent.change(screen.getByLabelText(/What changes each time/), { target: { value: 'the date' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        goal: 'Book parking for Friday',
        inputsHint: 'the date',
        sources: ['browser'],
        context: { projectId: 'p1', sessionId: 's1' }
      })
    )
    expect(await screen.findByText('Recording')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop and write skill' })).toBeTruthy()
  })

  it('shows drafting progress and a retry for failures in this chat only', () => {
    useRecordingStore.setState({
      setupOpen: false,
      jobs: {
        r1: { projectId: 'p1', sessionId: 's1', state: 'failed', error: 'rate limited', steps: 7 },
        r2: { projectId: 'p1', sessionId: 'other', state: 'drafting', steps: 3 }
      }
    })
    render(<RecordingBar sessionId="s1" />)
    expect(screen.getByText('Could not write the skill')).toBeTruthy()
    expect(screen.getByText('rate limited')).toBeTruthy()
    expect(screen.queryByText(/Writing the skill/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
