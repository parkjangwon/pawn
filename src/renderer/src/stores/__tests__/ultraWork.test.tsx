// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  ULW_DONE_MARKER,
  continuationPrompt,
  parseUltraWork,
  parseVerdict,
  selfReportedVerdict,
  ultraWorkPreamble,
  ultraWorkTriggerLength
} from '../../agent/ultraWork'
import { decideAfterTurn, useUltraWorkStore } from '../ultraWork'
import { isUltraWorkSession } from '../ultraWorkRegistry'
import { useProviderStore } from '../provider'
import UltraWorkBanner from '../../components/UltraWorkBanner'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${Object.values(opts).join('/')}` : key)
  })
}))

beforeEach(() => {
  ;(window as any).api = { shell: {}, browser: {}, db: {}, config: { save: vi.fn().mockResolvedValue({}) } }
  useUltraWorkStore.setState({ runs: {} })
  for (const id of ['s1', 's2']) useUltraWorkStore.getState().dismiss(id)
})

describe('parseUltraWork', () => {
  it.each([
    ['$ulw make the tests pass', 'make the tests pass'],
    ['/ultra-work migrate to ESM', 'migrate to ESM'],
    ['/ultrawork x', 'x'],
    ['  $ULW   fix it', 'fix it'],
    ['ulw: ship the release', 'ship the release'],
    ['울트라워크: 테스트 전부 통과시키기', '테스트 전부 통과시키기']
  ])('%s', (input, goal) => {
    expect(parseUltraWork(input)).toEqual({ goal, maxIterations: 12 })
  })

  it('does not fire on casual mentions or look-alikes', () => {
    expect(parseUltraWork('what is $ulw?')).toBeNull()
    expect(parseUltraWork('/ulwx do it')).toBeNull()
    expect(parseUltraWork('ultrawork is cool')).toBeNull()
  })

  it('parses and clamps the iteration budget', () => {
    expect(parseUltraWork('$ulw --max 20 refactor auth')).toEqual({ goal: 'refactor auth', maxIterations: 20 })
    expect(parseUltraWork('$ulw refactor --max=999')).toEqual({ goal: 'refactor', maxIterations: 40 })
  })

  it('returns an empty goal for a bare trigger and reports the keyword span', () => {
    expect(parseUltraWork('$ulw')).toEqual({ goal: '', maxIterations: 12 })
    expect(ultraWorkTriggerLength('$ulw fix')).toBe(4)
    expect(ultraWorkTriggerLength('/ultra-work fix')).toBe(11)
    expect(ultraWorkTriggerLength('hello')).toBe(0)
  })
})

describe('verdicts', () => {
  it('reads self-reported markers', () => {
    expect(selfReportedVerdict(`All green. ${ULW_DONE_MARKER}`)?.met).toBe(true)
    expect(selfReportedVerdict('<ultrawork>BLOCKED: no AWS creds</ultrawork>')).toEqual({
      met: false,
      blocked: true,
      reason: 'no AWS creds'
    })
    expect(selfReportedVerdict('still working')).toBeNull()
  })

  it('parses evaluator JSON leniently', () => {
    expect(parseVerdict('```json\n{"met": false, "reason": "2 tests still fail"}\n```')).toEqual({
      met: false,
      reason: '2 tests still fail'
    })
    expect(parseVerdict('{"met": true, "blocked": true}')).toEqual({ met: true, reason: 'Goal met.' })
    expect(parseVerdict('nope')).toBeNull()
    expect(parseVerdict('{"met": "yes"}')).toBeNull()
  })

  it('builds the contract preamble and continuation prompt', () => {
    const run = { goal: 'all tests pass', iteration: 3, maxIterations: 12 }
    expect(ultraWorkPreamble(run)).toContain('GOAL: all tests pass')
    expect(ultraWorkPreamble(run)).toContain(ULW_DONE_MARKER)
    const cont = continuationPrompt(run, 'auth.test.ts still fails')
    expect(cont).toContain('iteration 3/12')
    expect(cont).toContain('Evaluator: auth.test.ts still fails')
  })
})

describe('decideAfterTurn', () => {
  const run = () => useUltraWorkStore.getState().start('s1', 'tests pass', 3)

  it('continues with the evaluator reason when not met', async () => {
    const d = await decideAfterTurn(run(), 'done-ish', [], async () => ({ met: false, reason: 'lint fails' }))
    expect(d.action).toBe('continue')
    expect(d.prompt).toContain('iteration 2/3')
    expect(d.prompt).toContain('lint fails')
  })

  it('ends as achieved only when the evaluator agrees', async () => {
    const overclaim = await decideAfterTurn(run(), `done ${ULW_DONE_MARKER}`, [], async () => ({ met: false, reason: 'no test output shown' }))
    expect(overclaim.action).toBe('continue')
    const ok = await decideAfterTurn(run(), 'x', [], async () => ({ met: true, reason: 'npm test exits 0' }))
    expect(ok).toMatchObject({ action: 'end', status: 'achieved' })
  })

  it('falls back to the self-report without an evaluator', async () => {
    const d = await decideAfterTurn(run(), `ok ${ULW_DONE_MARKER}`, [], async () => null)
    expect(d).toMatchObject({ action: 'end', status: 'achieved' })
  })

  it('stops on blockers and on the iteration budget', async () => {
    const blocked = await decideAfterTurn(run(), '<ultrawork>BLOCKED: need a token</ultrawork>', [], async () => ({ met: false, reason: 'x' }))
    expect(blocked).toMatchObject({ action: 'end', status: 'unmet', reason: 'need a token' })
    const last = { ...run(), iteration: 3 }
    const budget = await decideAfterTurn(last, 'x', [], async () => ({ met: false, reason: 'still failing' }))
    expect(budget).toMatchObject({ action: 'end', status: 'budget_limited', reason: 'still failing' })
  })
})

describe('store + provider override', () => {
  it('forces MAXING only for the active session and releases it when stopped', () => {
    useProviderStore.setState({ harnessMode: 'eco' } as any)
    useUltraWorkStore.getState().start('s1', 'goal', 5)
    expect(isUltraWorkSession('s1')).toBe(true)
    expect(useProviderStore.getState().harnessModeFor('s1')).toBe('maxing')
    expect(useProviderStore.getState().harnessModeFor('s2')).toBe('eco')
    useUltraWorkStore.getState().stop('s1')
    expect(useUltraWorkStore.getState().get('s1')?.status).toBe('stopped')
    expect(useProviderStore.getState().harnessModeFor('s1')).toBe('eco')
  })
})

describe('UltraWorkBanner', () => {
  it('shows the goal, iteration, and a Stop button while active', () => {
    useUltraWorkStore.getState().start('s1', 'make CI green', 12)
    render(<UltraWorkBanner sessionId="s1" />)
    expect(screen.getByText('ULTRA WORK')).toHaveClass('ulw-rainbow-text')
    expect(screen.getByText('make CI green')).toBeInTheDocument()
    expect(screen.getByText('Iteration 1/12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(useUltraWorkStore.getState().get('s1')?.status).toBe('stopped')
  })

  it('shows the result and can be dismissed after the run ends', () => {
    useUltraWorkStore.getState().start('s1', 'g', 4)
    useUltraWorkStore.getState().update('s1', { status: 'achieved', endedAt: Date.now(), lastReason: 'npm test exits 0' })
    const { container } = render(<UltraWorkBanner sessionId="s1" />)
    expect(container.querySelector('.ulw-banner')).toHaveClass('ulw-achieved')
    expect(screen.getByText('npm test exits 0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useUltraWorkStore.getState().get('s1')).toBeUndefined()
  })
})
