// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeError, nudgeFor, StuckDetector, stuckDigest } from '../stuckRecovery'
import { clearOldToolResults, CLEARED_PREFIX, notesFromTranscript } from '../contextEditing'
import { buildCompactionSummary, type TranscriptEntry } from '../transcript'
import { findCheckpoint, markCheckpoint, planRestore } from '../checkpoints'
import { pickSecondOpinionModel } from '../secondOpinion'
import { executeTool } from '../toolExecutor'
import { getNotes, hydrateNotes, setNotes } from '../workingNotes'
import { useChangeLedger } from '../../stores/changeLedger'
import { useProviderStore } from '../../stores/provider'

const tc = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args })
const ok = (name: string, content = 'ok') => ({ name, content, isError: false })
const err = (name: string, content: string) => ({ name, content, isError: true })

describe('stuck detection ladder', () => {
  it('climbs reflect → escalate → second opinion → rollback → ask_user while the loop persists', () => {
    const d = new StuckDetector()
    const actions: string[] = []
    for (let i = 0; i < 14; i++) {
      const step = d.observe({ calls: [tc('grep_search', { query: 'foo' })], results: [ok('grep_search', 'No matches')] })
      if (step) actions.push(`${i + 1}:${step.action}`)
    }
    // First signal on round 3 (3 identical rounds), then every 2 rounds (cooldown).
    expect(actions.slice(0, 5)).toEqual(['3:reflect', '5:escalate', '7:second_opinion', '9:rollback', '11:ask_user'])
    // The top rung repeats (the loop stops there).
    expect(actions.slice(5).every((a) => a.endsWith('ask_user'))).toBe(true)
  })

  it('normalizes volatile error text so the same failure is recognized', () => {
    expect(normalizeError('Error at file.ts:12:5 after 351ms (0x1f)')).toBe(normalizeError('Error at file.ts:98:1 after 12ms (0xab)'))
    const d = new StuckDetector()
    let step = null
    for (let i = 0; i < 3; i++) {
      step = d.observe({
        calls: [tc('shell_exec', { command: `npm test -- --seed ${i}` })],
        results: [err('shell_exec', `FAIL src/a.test.ts:${10 + i}: expected 3 to be 4 (${i * 7}ms)`)]
      })
    }
    expect(step?.signal.kind).toBe('repeat_error')
    expect(step?.action).toBe('reflect')
    expect(step?.nudge).toContain('<stuck_recovery level="1" signal="repeat_error">')
  })

  it('detects edit thrash while checks keep failing, and read loops', () => {
    const d = new StuckDetector()
    let last = null
    for (let i = 0; i < 6; i++) {
      last = d.observe({
        calls: [tc('edit_file', { path: 'src/a.ts', old_string: `v${i}`, new_string: `v${i + 1}` }), tc('run_checks', { kind: 'test', n: i })],
        results: [ok('edit_file'), err('run_checks', `FAIL ${i}`)]
      }) ?? last
    }
    expect(['edit_thrash', 'error_streak', 'repeat_error']).toContain(last?.signal.kind)
    const r = new StuckDetector()
    let read = null
    for (let i = 0; i < 4; i++) read = r.observe({ calls: [tc('read_file', { path: 'a.ts' }), tc('list_dir', { path: String(i) })], results: [ok('read_file'), ok('list_dir')] }) ?? read
    expect(read?.signal.kind).toBe('read_loop')
  })

  it('stays quiet during normal progress', () => {
    const d = new StuckDetector()
    for (let i = 0; i < 20; i++) {
      expect(d.observe({ calls: [tc('read_file', { path: `f${i}.ts` }), tc('edit_file', { path: `f${i}.ts` })], results: [ok('read_file'), ok('edit_file')] })).toBeNull()
    }
    expect(nudgeFor(5, 'ask_user', { kind: 'error_streak', detail: 'x' })).toContain('explain to the user')
    expect(stuckDigest('fix the bug', [{ call: 'a()', result: 'boom', isError: true }], { kind: 'repeat_error', detail: 'a failed' })).toContain('→ ERROR boom')
  })
})

describe('tool-result clearing', () => {
  const big = (n: number) => 'x'.repeat(n)
  const entries = (): TranscriptEntry[] => {
    const out: TranscriptEntry[] = [{ role: 'user', content: 'task' }]
    for (let i = 0; i < 14; i++) {
      out.push({ role: 'assistant', content: '', toolCalls: [{ id: `t${i}`, name: i === 2 ? 'update_plan' : i === 4 ? 'working_notes' : 'read_file', arguments: { path: `src/f${i}.ts` } }] })
      out.push({
        role: 'tool',
        toolCallId: `t${i}`,
        name: i === 2 ? 'update_plan' : i === 4 ? 'working_notes' : 'read_file',
        content: i === 4 ? `<working_notes>\nold notes\n</working_notes>` + big(3000) : i === 5 ? 'short' : big(20_000)
      })
    }
    return out
  }

  it('clears the oldest bulky results, keeps recent/exempt/short ones, and offloads the full text', async () => {
    const offload = vi.fn(async () => 'out_deadbeef')
    const res = await clearOldToolResults(entries(), { keepRecent: 4, targetTokens: 12_000, minTokens: 2_000, offload })
    expect(res.cleared).toBeGreaterThan(0)
    const tools = res.entries.filter((e): e is Extract<TranscriptEntry, { role: 'tool' }> => e.role === 'tool')
    expect(tools[0].content.startsWith(CLEARED_PREFIX)).toBe(true)
    expect(tools[0].content).toContain('read_file src/f0.ts returned 20,000 chars')
    expect(tools[0].content).toContain('read_output {"id":"out_deadbeef"}')
    expect(tools[2].name).toBe('update_plan')
    expect(tools[2].content.startsWith(CLEARED_PREFIX)).toBe(false) // exempt
    expect(tools[5].content).toBe('short') // too small to matter
    expect(tools.slice(-4).every((t) => !t.content.startsWith(CLEARED_PREFIX))).toBe(true) // recent kept
    expect(res.tokensSaved).toBeGreaterThanOrEqual(12_000)
    // Idempotent: placeholders are never cleared again.
    const again = await clearOldToolResults(res.entries, { keepRecent: 4, targetTokens: 1e9, minTokens: 1 })
    expect(again.entries.filter((e) => e.role === 'tool' && e.content.startsWith(CLEARED_PREFIX)).length).toBeGreaterThanOrEqual(res.cleared)
  })

  it('does nothing when too little can be cleared', async () => {
    const res = await clearOldToolResults(entries().slice(0, 5), { keepRecent: 1, minTokens: 100_000 })
    expect(res.cleared).toBe(0)
  })

  it('supersedes older working notes but keeps the latest, and carries notes through compaction', async () => {
    const e = entries()
    e.push({ role: 'assistant', content: '', toolCalls: [{ id: 'n2', name: 'working_notes', arguments: { action: 'set' } }] })
    e.push({ role: 'tool', toolCallId: 'n2', name: 'working_notes', content: '<working_notes>\nnew notes\n</working_notes>' })
    const res = await clearOldToolResults(e, { keepRecent: 2, minTokens: 1 })
    const notes = res.entries.filter((x): x is Extract<TranscriptEntry, { role: 'tool' }> => x.role === 'tool' && x.name === 'working_notes')
    expect(notes[0].content).toContain('superseded')
    expect(notesFromTranscript(res.entries)).toBe('new notes')
    const summary = buildCompactionSummary(res.entries, { notes: 'new notes' })
    expect(summary).toContain('<working_notes>\nnew notes\n</working_notes>')
    expect(notesFromTranscript([{ role: 'summary', content: summary }, { role: 'user', content: 'go on' }])).toBe('new notes')
  })
})

describe('working notes tool', () => {
  beforeEach(() => {
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
    ;(window as any).api = {}
    setNotes('s1', '')
  })
  it('sets, appends and views notes; the result always carries the full text', async () => {
    const ctx = { sessionId: 's1' }
    const a = await executeTool({ id: '1', name: 'working_notes', arguments: { action: 'set', content: '- bug is in parser' } }, '/p', undefined, ctx)
    expect(a.content).toContain('<working_notes>\n- bug is in parser\n</working_notes>')
    const b = await executeTool({ id: '2', name: 'working_notes', arguments: { action: 'append', content: '- next: add test' } }, '/p', undefined, ctx)
    expect(b.content).toContain('- bug is in parser\n- next: add test')
    expect(getNotes('s1')).toBe('- bug is in parser\n- next: add test')
    const tooBig = await executeTool({ id: '3', name: 'working_notes', arguments: { action: 'set', content: 'x'.repeat(9000) } }, '/p', undefined, ctx)
    expect(tooBig.isError).toBe(true)
    expect(hydrateNotes('s1', [{ role: 'tool', toolCallId: '2', name: 'working_notes', content: b.content }])).toBe('- bug is in parser\n- next: add test')
    // Allowed in Plan mode (it is the agent's own scratchpad).
    useProviderStore.setState({ agentMode: 'plan' } as any)
    expect((await executeTool({ id: '4', name: 'working_notes', arguments: { action: 'view' } }, '/p', undefined, ctx)).isError).toBeFalsy()
  })
})

describe('checkpoints', () => {
  let files: Map<string, string>
  const read = async (p: string) => files.get(p) ?? null
  beforeEach(() => {
    files = new Map([['/p/a.ts', 'A0'], ['/p/b.ts', 'B0']])
    useChangeLedger.setState({ turns: [], activeTurnId: null } as any)
    useChangeLedger.getState().beginTurn('s1', 'p1', 'x')
  })

  it('restores agent-touched files to the mark (and new ones to their original state)', async () => {
    const ledger = useChangeLedger.getState()
    // Before the mark: agent edits a.ts.
    files.set('/p/a.ts', 'A1')
    ledger.recordChange({ path: '/p/a.ts', before: 'A0', after: 'A1', op: 'edit' })
    const cp = await markCheckpoint('s1', 'green', read)
    expect(Array.from(cp.files.entries())).toEqual([['/p/a.ts', 'A1']])
    // After the mark: more edits, a new file, a touched b.ts.
    files.set('/p/a.ts', 'A2')
    ledger.recordChange({ path: '/p/a.ts', before: 'A0', after: 'A2', op: 'edit' })
    files.set('/p/b.ts', 'B1')
    ledger.recordChange({ path: '/p/b.ts', before: 'B0', after: 'B1', op: 'edit' })
    files.set('/p/c.ts', 'C1')
    ledger.recordChange({ path: '/p/c.ts', before: null, after: 'C1', op: 'write' })
    const writes = await planRestore('s1', findCheckpoint('s1')!, read)
    const byPath = Object.fromEntries(writes.map((w) => [w.path, w.after]))
    expect(byPath).toEqual({ '/p/a.ts': 'A1', '/p/b.ts': 'B0', '/p/c.ts': null })
    expect(findCheckpoint('s1', 'nope')).toBeNull()
  })

  it('restores through the tool with undo records', async () => {
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
    ;(window as any).api = {
      fs: {
        readFile: async (p: string) => (files.has(p) ? files.get(p) : { error: 'ENOENT' }),
        writeFile: async (p: string, c: string) => {
          files.set(p, c)
          return { ok: true }
        },
        delete: async (p: string) => {
          files.delete(p)
          return { ok: true }
        }
      }
    }
    const ctx = { sessionId: 's2' }
    useChangeLedger.getState().beginTurn('s2', 'p1', 'y')
    const m = await executeTool({ id: '1', name: 'checkpoint_mark', arguments: { label: 'start' } }, '/p', undefined, ctx)
    expect(m.content).toContain('Checkpoint "start" marked')
    files.set('/p/a.ts', 'broken')
    useChangeLedger.getState().recordChange({ path: '/p/a.ts', before: 'A0', after: 'broken', op: 'edit' })
    const r = await executeTool({ id: '2', name: 'checkpoint_restore', arguments: {} }, '/p', undefined, ctx)
    expect(r.content).toContain('M a.ts')
    expect(files.get('/p/a.ts')).toBe('A0')
    const list = await executeTool({ id: '3', name: 'checkpoint_restore', arguments: { list: true } }, '/p', undefined, ctx)
    expect(list.content).toContain('start')
  })
})

describe('second opinion model choice', () => {
  it('prefers the strongest model from another provider', () => {
    useProviderStore.setState({
      providers: [
        { id: 'a', name: 'A', apiFormat: 'openai', baseUrl: 'http://a', apiKey: 'k', enabled: true },
        { id: 'b', name: 'B', apiFormat: 'claude', baseUrl: 'http://b', apiKey: 'k', enabled: true }
      ],
      models: [
        { id: 'a:m1', providerId: 'a', modelId: 'm1', label: 'A1', tier: 'high', enabled: true },
        { id: 'a:m2', providerId: 'a', modelId: 'm2', label: 'A2', tier: 'high', enabled: true },
        { id: 'b:low', providerId: 'b', modelId: 'low', label: 'B low', tier: 'low', enabled: true },
        { id: 'b:high', providerId: 'b', modelId: 'high', label: 'B high', tier: 'high', enabled: true }
      ]
    } as any)
    expect(pickSecondOpinionModel('a:m1')?.model.modelId).toBe('high')
    useProviderStore.setState({ models: useProviderStore.getState().models.filter((m) => m.providerId === 'a') } as any)
    expect(pickSecondOpinionModel('a:m1')?.model.modelId).toBe('m2')
  })
})
