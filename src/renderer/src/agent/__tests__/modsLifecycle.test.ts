import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureModsLoaded, reloadMods, __resetModsClientForTests } from '../mods/client'
import { getModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { useModsUiStore } from '../mods/uiStore'

/** Node caches data: URL imports, so every load needs its own source text. */
let seq = 0
function src(body: string): string {
  seq += 1
  return `${body}\n// load ${seq}\n`
}

const ctx = (project: string, sessionId = 's') => ({
  sessionId,
  cwd: project,
  projectPath: project
})

beforeEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  useModsUiStore.getState().clearSessionUi()
  seq = 0
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete (globalThis as { window?: unknown }).window
})

describe('mods load serialization', () => {
  it('runs concurrent reloadMods and ensureModsLoaded one after another', async () => {
    let n = 0
    let release: () => void = () => {}
    const loadSources = vi.fn((project: string) => {
      n += 1
      const id = n
      const payload = {
        ok: true,
        sources: [
          {
            id: `m@${id}`,
            name: 'm',
            root: project,
            tier: 'user',
            sources: [src(`export function register() { /* ${project} ${id} */ }`)]
          }
        ]
      }
      if (id === 1) return new Promise((resolve) => { release = () => resolve(payload) })
      return Promise.resolve(payload)
    })
    ;(globalThis as { window?: unknown }).window = { api: { mods: { loadSources } } }

    const first = ensureModsLoaded(ctx('/p'))
    await vi.waitUntil(() => n === 1)
    const second = reloadMods(ctx('/p'))
    await new Promise((r) => setTimeout(r, 0))
    expect(n).toBe(1)
    release()
    await first
    await second
    expect(n).toBe(2)
    expect(getModRuntime().getLoaded()).toHaveLength(1)
  })

  it('same-project ensureModsLoaded waits for the in-flight load before retargeting', async () => {
    let release: () => void = () => {}
    const payload = {
      ok: true,
      sources: [
        {
          id: 'm@1',
          name: 'm',
          root: '/p',
          tier: 'user',
          sources: [src('export function register() {}')]
        }
      ]
    }
    const loadSources = vi.fn(
      () => new Promise((resolve) => { release = () => resolve(payload) })
    )
    ;(globalThis as { window?: unknown }).window = { api: { mods: { loadSources } } }

    const first = ensureModsLoaded(ctx('/p', 'a'))
    await vi.waitUntil(() => loadSources.mock.calls.length === 1)
    const second = ensureModsLoaded(ctx('/p', 'b'))
    await new Promise((r) => setTimeout(r, 0))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((getModRuntime() as any).ctx.sessionId).toBe('a')
    release()
    await first
    await second
    expect(loadSources).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((getModRuntime() as any).ctx.sessionId).toBe('b')
  })

  it('does not let a stale catch clear a newer load', async () => {
    const rt = getModRuntime()
    const real = rt.load.bind(rt)
    let n = 0
    let rejectFirst: (err: Error) => void = () => {}
    let releaseSecond: () => void = () => {}
    rt.load = (async (sources) => {
      n += 1
      if (n === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirst = reject
        })
      }
      if (n === 2) await new Promise<void>((resolve) => { releaseSecond = resolve })
      return real(sources)
    }) as typeof rt.load

    let loads = 0
    const loadSources = vi.fn((project: string) => {
      loads += 1
      return Promise.resolve({
        ok: true,
        sources: [
          {
            id: `m@${project}`,
            name: 'm',
            root: project,
            tier: 'user',
            sources: [src(`export function register() { /* ${project} */ }`)]
          }
        ]
      })
    })
    ;(globalThis as { window?: unknown }).window = { api: { mods: { loadSources } } }

    const a = ensureModsLoaded(ctx('/p1'))
    await vi.waitUntil(() => n === 1)
    const b = ensureModsLoaded(ctx('/p2'))
    rejectFirst(new Error('stale'))
    await a
    await vi.waitUntil(() => n === 2)
    const c = ensureModsLoaded(ctx('/p2'))
    await new Promise((r) => setTimeout(r, 0))
    expect(n).toBe(2)
    releaseSecond()
    await b
    await c
    expect(n).toBe(2)
    expect(loads).toBe(2)
    expect(getModRuntime().getLoaded()).toHaveLength(1)
    expect(getModRuntime().getLoaded()[0]?.root).toBe('/p2')
  })
})

describe('mods session scope', () => {
  const sessionMod = (): string =>
    src(
      [
        'export function register(on) {',
        "  on('chat.switch', async (api, e, next) => {",
        "    api.ui.log(e.from + '>' + e.to + ':' + api.session.id())",
        '    return next(e)',
        '  })',
        "  on('command.run', { command: 'inc' }, async (api) => {",
        "    const n = Number(api.state.get('n') || 0) + 1",
        "    api.state.set('n', n)",
        "    return { text: String(n) }",
        '  })',
        "  on('command.run', { command: 'who' }, async (api) => ({ text: String(api.state.get('who') || '') })),",
        "  on('turn.start', async (api, e, next) => {",
        "    api.ui.log('start ' + api.session.id() + ' ' + e.sessionId)",
        '    return next(e)',
        '  })',
        "  on('tool.call', async (api, e, next) => {",
        "    api.state.set('who', api.session.id())",
        "    api.ui.log('tool ' + api.session.id() + ' ' + e.sessionId)",
        '    return next(e)',
        '  })',
        "  on('tool.check', async (api, e, next) => {",
        "    api.ui.log('check ' + api.session.id() + ' ' + e.sessionId)",
        '    return next(e)',
        '  })',
        "  on('turn.complete', async (api, e, next) => {",
        "    api.ui.log('done ' + api.session.id() + ' ' + e.sessionId)",
        '    return next(e)',
        '  })',
        "  on('ui.render', { component: 'Spinner' }, async (api, e, next) => {",
        "    api.ui.log('spin ' + api.session.id())",
        '    return next({ ...e, props: { ...e.props, suffix: api.session.id() } })',
        '  })',
        '}'
      ].join('\n')
    )

  async function load(sessionId = 'A'): Promise<void> {
    const rt = getModRuntime()
    rt.setContext({ sessionId, cwd: '/p' })
    await rt.load([
      { id: 'scope@t', name: 'scope', root: '/p', tier: 'user', sources: [sessionMod()] }
    ])
    useModsUiStore.getState().clearSessionUi()
  }

  function logs(): string[] {
    return useModsUiStore.getState().logs.map((l) => l.text)
  }

  it('emits chat.switch and keeps $.state per chat', async () => {
    await load('a')
    const rt = getModRuntime()
    rt.setContext({ sessionId: 'pending', cwd: '/p' })
    rt.setContext({ sessionId: 'a', cwd: '/p' })
    await new Promise((r) => setTimeout(r, 0))
    expect(logs()).toEqual([])

    rt.setContext({ sessionId: 'b', cwd: '/p' })
    await vi.waitFor(() => expect(logs()).toEqual(['a>b:b']))

    expect((await rt.emitCommandRun('inc', '')).text).toBe('1')
    rt.setContext({ sessionId: 'a', cwd: '/p' })
    expect((await rt.emitCommandRun('inc', '')).text).toBe('1')
    rt.setContext({ sessionId: 'b', cwd: '/p' })
    expect((await rt.emitCommandRun('inc', '')).text).toBe('2')
    rt.setContext({ sessionId: 'a', cwd: '/p' })
    expect((await rt.emitCommandRun('inc', '')).text).toBe('2')
  })

  it('dispatches background turn events with the session captured at turn start', async () => {
    await load('A')
    const rt = getModRuntime()
    await rt.emit('turn.start', { sessionId: 'A' }, async (e) => e)
    rt.setContext({ sessionId: 'B', cwd: '/p' })
    await vi.waitFor(() => expect(logs()).toContain('A>B:B'))
    await rt.emitToolCall('read_file', {}, async () => ({ result: 'ok' }), undefined, 'A')
    await rt.emit('tool.check', { tool: 'read_file', sessionId: 'A' }, async (e) => e)
    const suffix = await rt.refreshSpinnerSuffix({}, 'A')
    await rt.emit('turn.complete', { sessionId: 'A', status: 'completed' }, async (e) => e)

    expect(logs()).toEqual(['start A A', 'A>B:B', 'tool A A', 'check A A', 'spin A', 'done A A'])
    expect(suffix).toBe('A')
    expect(useModsUiStore.getState().spinnerSuffix).toBe('')

    useModsUiStore.getState().clearSessionUi()
    await rt.emit('turn.start', { sessionId: 'A' }, async (e) => e)
    rt.setContext({ sessionId: 'B', cwd: '/p' })
    await rt.emit('turn.start', { sessionId: 'B' }, async (e) => e)
    await rt.emitToolCall('read_file', {}, async () => ({ result: 'ok' }), undefined, 'A')
    expect(logs().filter((line) => line.startsWith('tool'))).toEqual(['tool A A'])
    expect((await rt.emitCommandRun('who', '')).text).toBe('')
    rt.setContext({ sessionId: 'A', cwd: '/p' })
    expect((await rt.emitCommandRun('who', '')).text).toBe('A')
  })

  it('keeps state separate for two chats running concurrently', async () => {
    const rt = getModRuntime()
    rt.setContext({ sessionId: 'A', cwd: '/p' })
    await rt.load([
      {
        id: 'conc@t',
        name: 'conc',
        root: '/p',
        tier: 'user',
        sources: [
          src(
            [
              'export function register(on) {',
              "  on('tool.call', async (api, e, next) => {",
              '    const before = api.session.id()',
              '    await new Promise((r) => setTimeout(r, Number(e.delay || 0)))',
              '    const after = api.session.id()',
              "    const n = Number(api.state.get('n') || 0) + 1",
              "    api.state.set('n', n)",
              "    api.ui.log(before + ' ' + after + ' ' + n)",
              '    return next(e)',
              '  })',
              "  on('command.run', { command: 'n' }, async (api) => ({ text: String(api.state.get('n') || 0) }))",
              '}'
            ].join('\n')
          )
        ]
      }
    ])
    useModsUiStore.getState().clearSessionUi()
    await rt.emit('turn.start', { sessionId: 'A' }, async (e) => e)
    await rt.emit('turn.start', { sessionId: 'B' }, async (e) => e)
    const ok = async () => ({ result: 'ok' })
    const pending = Promise.all([
      rt.emitToolCall('t', { delay: 5 }, ok, undefined, 'A'),
      rt.emitToolCall('t', { delay: 30 }, ok, undefined, 'B')
    ])
    // A finishes first while B is still running; with a shared session slot A would read B.
    await new Promise((r) => setTimeout(r, 15))
    rt.setContext({ sessionId: 'B', cwd: '/p' })
    await pending
    expect(logs().sort()).toEqual(['A A 1', 'B B 1'])
    rt.setContext({ sessionId: 'A', cwd: '/p' })
    expect((await rt.emitCommandRun('n', '')).text).toBe('1')
    rt.setContext({ sessionId: 'B', cwd: '/p' })
    expect((await rt.emitCommandRun('n', '')).text).toBe('1')
  })
})
