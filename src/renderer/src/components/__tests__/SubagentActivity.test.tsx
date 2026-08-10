/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SubagentActivity from '../SubagentActivity'
import { useSubagentRunsStore, type SubagentRun } from '../../stores/subagentRuns'
import { useProviderStore } from '../../stores/provider'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

function makeRun(partial: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: 'r1',
    name: 'scan',
    agent: 'explore',
    mode: 'explore',
    status: 'running',
    parentSessionId: 's1',
    background: false,
    startedAt: Date.now() - 5000,
    rounds: 2,
    toolsUsed: ['read_file'],
    maxRounds: 12,
    promptPreview: 'scan the codebase for auth',
    ...partial
  }
}

function seedRuns(...runs: SubagentRun[]): void {
  useSubagentRunsStore.setState({ runs })
}

beforeEach(() => {
  useSubagentRunsStore.setState({ runs: [] })
  useProviderStore.setState({ autoOpenAgentsPanel: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SubagentActivity', () => {
  it('renders nothing with no runs for the session', () => {
    seedRuns(makeRun({ id: 'other', parentSessionId: 's2' }))
    const { container } = render(<SubagentActivity sessionId="s1" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a collapsed bar while runs are live and expands to task rows', () => {
    seedRuns(makeRun(), makeRun({ id: 'r2', name: 'review', status: 'running' }))
    const { container } = render(<SubagentActivity sessionId="s1" />)
    expect(screen.getByText('subagents.inlineWorking')).toBeInTheDocument()
    // Collapsed: no run rows yet.
    expect(screen.queryByText('scan')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('scan')).toBeInTheDocument()
    expect(screen.getAllByText('[explore]')).toHaveLength(2)
    expect(screen.getAllByText('scan the codebase for auth')).toHaveLength(2)
    expect(container.querySelector('.subagent-activity-row.status-running')).not.toBeNull()
  })

  it('respects the autoOpenAgentsPanel preference', () => {
    useProviderStore.setState({ autoOpenAgentsPanel: false })
    seedRuns(makeRun())
    const { container } = render(<SubagentActivity sessionId="s1" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a done state briefly, then disappears after the recent window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    seedRuns(makeRun({ status: 'ok', finishedAt: Date.now() - 5000, rounds: 4 }))
    const { container } = render(<SubagentActivity sessionId="s1" />)
    expect(screen.getByText('subagents.inlineDone')).toBeInTheDocument()

    // Advance past the 15s recent-done window → widget hides itself.
    act(() => { vi.advanceTimersByTime(16_000) })
    expect(container.firstChild).toBeNull()
  })

  it('ignores runs from other sessions and lets the user stop a running run', () => {
    const cancel = vi.spyOn(useSubagentRunsStore.getState(), 'cancel').mockImplementation(() => true)
    seedRuns(
      makeRun(),
      makeRun({ id: 'other', name: 'foreign', parentSessionId: 's2' })
    )
    render(<SubagentActivity sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByText('foreign')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'subagents.cancel' }))
    expect(cancel).toHaveBeenCalledWith('r1')
    cancel.mockRestore()
  })
})
