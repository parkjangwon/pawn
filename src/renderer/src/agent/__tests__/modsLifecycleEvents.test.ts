import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { __resetModsClientForTests } from '../mods/client'
import { useModsUiStore } from '../mods/uiStore'
import { deriveModCapabilities, normalizeModEvent } from '../mods/capabilities'
import { modSubagentStart, modSubagentStop, modToolOutcome } from '../mods/lifecycleEvents'

const D = (src: string): string => src.replace(/__API__/g, '$')
async function loadMod(name: string, lines: string[]): Promise<void> {
  await getModRuntime().load([{ id: `${name}@test`, name, root: `/tmp/${name}`, tier: 'user', sources: [D(lines.join('\n'))] }])
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
type Seen = Array<[string, Record<string, unknown>]>
const seen = (): Seen => (globalThis as { __seenL?: Seen }).__seenL!

beforeEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  useModsUiStore.getState().clearSessionUi()
  ;(globalThis as { __seenL?: Seen }).__seenL = []
})
afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  vi.restoreAllMocks()
})

const recorder = (ev: string): string => `  on('${ev}', async (__API__, e, next) => { globalThis.__seenL.push(['${ev}', JSON.parse(JSON.stringify(e))]); return next(e) })`

describe('Claude Code lifecycle hooks (formerly accepted, not emitted)', () => {
  it('maps the names and rates them', () => {
    expect(normalizeModEvent('PostToolUse')).toBe('tool.result')
    expect(normalizeModEvent('classic.PostToolUseFailure')).toBe('tool.error')
    expect(normalizeModEvent('SubagentStart')).toBe('subagent.start')
    expect(normalizeModEvent('classic.SubagentStop')).toBe('subagent.stop')
    expect(deriveModCapabilities(['PostToolUse'], []).map((c) => c.id)).toEqual(['tools'])
    expect(deriveModCapabilities(['SubagentStop'], []).map((c) => c.id)).toEqual(['subagents'])
  })

  it('PostToolUse gets a Claude-shaped payload after a successful tool', async () => {
    await loadMod('post', ['export function register(on) {', recorder('PostToolUse'), recorder('PostToolUseFailure'), '}'])
    modToolOutcome({ sessionId: 's1', tool: 'read_file', toolUseId: 'call_1', input: { path: 'a.txt' }, content: 'hello', isError: false })
    await flush()
    expect(seen()).toEqual([['PostToolUse', {
      sessionId: 's1', tool: 'read_file', tool_name: 'read_file', tool_use_id: 'call_1',
      tool_input: { path: 'a.txt' }, tool_response: { content: 'hello', isError: false }
    }]])
  })

  it('PostToolUseFailure gets the error and PostToolUse does not fire', async () => {
    await loadMod('post', ['export function register(on) {', recorder('PostToolUse'), recorder('classic.PostToolUseFailure'), '}'])
    modToolOutcome({ sessionId: 's1', tool: 'shell_exec', toolUseId: 'c2', input: { command: 'false' }, content: 'exit 1', isError: true })
    await flush()
    expect(seen()).toEqual([['classic.PostToolUseFailure', {
      sessionId: 's1', tool: 'shell_exec', tool_name: 'shell_exec', tool_use_id: 'c2', tool_input: { command: 'false' }, error: 'exit 1'
    }]])
  })

  it('a tool matcher narrows tool.result', async () => {
    await loadMod('m', ['export function register(on) {', "  on('tool.result', { tool: 'shell_exec' }, async (__API__, e, next) => { globalThis.__seenL.push(['m', e.tool]); return next(e) })", '}'])
    modToolOutcome({ tool: 'read_file', toolUseId: 'a', input: {}, content: '', isError: false })
    modToolOutcome({ tool: 'shell_exec', toolUseId: 'b', input: {}, content: '', isError: false })
    await flush()
    expect(seen()).toEqual([['m', 'shell_exec']])
  })

  it('SubagentStart / SubagentStop carry id, type, result', async () => {
    await loadMod('sub', ['export function register(on) {', recorder('SubagentStart'), recorder('SubagentStop'), '}'])
    modSubagentStart({ sessionId: 's1', runId: 'subrun-1', agent: 'explore', name: 'scan', prompt: 'find x', background: false })
    modSubagentStop({ sessionId: 's1', runId: 'subrun-1', agent: 'explore', name: 'scan', status: 'ok', summary: 'found x', rounds: 2, toolsUsed: ['grep'] })
    await flush()
    expect(seen()[0]).toEqual(['SubagentStart', { sessionId: 's1', agent_id: 'subrun-1', agent_type: 'explore', name: 'scan', prompt: 'find x', background: false }])
    expect(seen()[1]).toEqual(['SubagentStop', {
      sessionId: 's1', agent_id: 'subrun-1', agent_type: 'explore', name: 'scan', status: 'ok', ok: true,
      summary: 'found x', rounds: 2, toolsUsed: ['grep'], filesChanged: []
    }])
  })

  it('a throwing or hanging mod never reaches the caller', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadMod('bad', [
      'export function register(on) {',
      "  on('tool.result', async () => { throw new Error('boom') })",
      "  on('subagent.stop', () => new Promise(() => {}))",
      '}'
    ])
    expect(() => modToolOutcome({ tool: 't', toolUseId: 'x', input: {}, content: 'ok', isError: false })).not.toThrow()
    const t0 = Date.now()
    modSubagentStop({ runId: 'r', agent: 'a', name: 'n', status: 'error', summary: '', error: 'e', rounds: 0, toolsUsed: [] })
    expect(Date.now() - t0).toBeLessThan(50) // not awaited
    await flush()
  })

  it('payloads are frozen: a mod cannot mutate them', async () => {
    await loadMod('mut', ['export function register(on) {', "  on('tool.result', async (__API__, e, next) => { try { e.tool_response.content = 'x' } catch { globalThis.__seenL.push(['frozen', {}]) } return next(e) })", '}'])
    modToolOutcome({ tool: 't', toolUseId: 'x', input: {}, content: 'ok', isError: false })
    await flush()
    expect(seen()).toEqual([['frozen', {}]])
  })

  it('refuses these events when registered through a computed name', async () => {
    await loadMod('sneaky', [
      "const ev = ['tool', 'result'].join('.')",
      "const sv = ['subagent', 'stop'].join('.')",
      'export function register(on) {',
      "  try { on(ev, async (__API__, e, next) => next(e)) } catch { globalThis.__seenL.push(['refused', {}]) }",
      "  try { on(sv, async (__API__, e, next) => next(e)) } catch { globalThis.__seenL.push(['refused', {}]) }",
      '}'
    ])
    expect(getModRuntime().hasHooks('tool.result')).toBe(false)
    expect(getModRuntime().hasHooks('subagent.stop')).toBe(false)
    expect(seen()).toHaveLength(2)
  })

  it('no listener means no emit work at all', () => {
    const spy = vi.spyOn(getModRuntime(), 'emit')
    modToolOutcome({ tool: 't', toolUseId: 'x', input: {}, content: 'ok', isError: false })
    modSubagentStart({ runId: 'r', agent: 'a', name: 'n', prompt: 'p', background: false })
    expect(spy).not.toHaveBeenCalled()
  })
})
