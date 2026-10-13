import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureModsLoaded, reloadMods, __resetModsClientForTests } from '../mods/client'
import { getModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { useModsUiStore } from '../mods/uiStore'

const COUNTER_MOD = [
  'let calls = 0',
  'export function register(on) {',
  "  on('tool.call', async (_api, e, next) => { calls += 1; return next(e) })",
  "  on('command.run', { command: 'count' }, async () => ({ text: String(calls) }))",
  "  on('session.start', async (api, e, next) => {",
  "    if (e.plugin === api.plugin.name) await api.command.register({ name: 'count', description: 'n' })",
  '    return next(e)',
  '  })',
  '}'
].join('\n')

let loadSources: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  useModsUiStore.getState().clearSessionUi()
  // A fresh source string per call so Node's data: URL module cache cannot
  // hand back the previous instance; a real reload gets a fresh module too.
  let n = 0
  loadSources = vi.fn(async () => ({
    ok: true,
    sources: [
      { id: 'counter@t', name: 'counter', root: '/tmp/counter', tier: 'user', sources: [`${COUNTER_MOD}\n// load ${++n}`] }
    ]
  }))
  ;(globalThis as { window?: unknown }).window = { api: { mods: { loadSources } } }
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete (globalThis as { window?: unknown }).window
})

const count = async (): Promise<string | undefined> => (await getModRuntime().emitCommandRun('count', '')).text

describe('mods load lifecycle', () => {
  it('keeps one load (and mod state) across chat switches in the same project', async () => {
    await ensureModsLoaded({ sessionId: 'chat-a', cwd: '/p', projectPath: '/p' })
    await getModRuntime().emitToolCall('read_file', {}, async () => ({ result: 'ok' }))
    expect(await count()).toBe('1')

    await ensureModsLoaded({ sessionId: 'chat-b', cwd: '/p', projectPath: '/p' })
    expect(loadSources).toHaveBeenCalledTimes(1)
    expect(await count()).toBe('1')
  })

  it('clears per-chat chrome on a chat switch but not on pending → first chat', async () => {
    const ui = useModsUiStore.getState()
    await ensureModsLoaded({ sessionId: 'pending', cwd: '/p', projectPath: '/p' })
    ui.openPane({ id: 'x', title: 'x', plugin: 'counter', placement: 'dock' } as never)
    await ensureModsLoaded({ sessionId: 'chat-a', cwd: '/p', projectPath: '/p' })
    expect(useModsUiStore.getState().panes).toHaveLength(1)
    await ensureModsLoaded({ sessionId: 'chat-b', cwd: '/p', projectPath: '/p' })
    expect(useModsUiStore.getState().panes).toHaveLength(0)
  })

  it('reloads when the project changes, and serialises overlapping loads', async () => {
    const a = ensureModsLoaded({ sessionId: 's', cwd: '/p1', projectPath: '/p1' })
    const b = ensureModsLoaded({ sessionId: 's', cwd: '/p2', projectPath: '/p2' })
    await Promise.all([a, b])
    expect(loadSources.mock.calls.map((c) => c[0])).toEqual(['/p1', '/p2'])
    expect(getModRuntime().getLoaded()).toHaveLength(1)
    expect(getModRuntime().getCommands().filter((c) => c.name === 'count')).toHaveLength(1)
  })

  it('reloadMods always re-reads sources', async () => {
    await ensureModsLoaded({ sessionId: 's', cwd: '/p', projectPath: '/p' })
    await reloadMods({ sessionId: 's', cwd: '/p', projectPath: '/p' })
    expect(loadSources).toHaveBeenCalledTimes(2)
  })
})
