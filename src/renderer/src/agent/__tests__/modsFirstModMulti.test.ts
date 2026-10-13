import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { useModsUiStore } from '../mods/uiStore'

const REGISTER_JS = readFileSync(
  join(fileURLToPath(new URL('../../../../..', import.meta.url)), 'examples/mods/first-mod/hooks/register.js'),
  'utf-8'
)

/** A second mod that also listens to session.start, like any real neighbour. */
const OTHER_MOD = [
  'export function register(on) {',
  "  on('session.start', async (_api, e, next) => next(e))",
  '}'
].join('\n')

describe('bundled first-mod next to another mod', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __resetModRuntimeForTests()
    useModsUiStore.getState().clearSessionUi()
  })

  it.each([
    ['first-mod loads first', ['first-mod', 'other-mod']],
    ['first-mod loads second', ['other-mod', 'first-mod']]
  ])('registers /tally and ping once with no session.start failure (%s)', async (_label, order) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rt = new ModRuntime()
    rt.setContext({ sessionId: 's1', cwd: '/tmp' })
    const src = (name: string): { id: string; name: string; root: string; tier: 'user'; sources: string[] } => ({
      id: `${name}@test`,
      name,
      root: `/tmp/${name}`,
      tier: 'user',
      sources: [name === 'first-mod' ? REGISTER_JS : OTHER_MOD]
    })
    await rt.load(order.map(src))

    const failures = warn.mock.calls.map((c) => c.map(String).join(' ')).filter((s) => s.includes('session.start'))
    expect(failures).toEqual([])
    expect(rt.getCommands().filter((c) => c.name === 'tally')).toHaveLength(1)
    expect(rt.getTools().map((t) => t.fullName)).toEqual(['mcp__first-mod__ping'])
    expect(rt.getLoaded().every((m) => !m.error)).toBe(true)

    // Node caches the module by its data: URL, so compare counts instead of
    // assuming the counter starts at zero.
    const count = async (): Promise<number> =>
      Number(/made (\d+) tool calls/.exec((await rt.emitCommandRun('tally', '')).text || '')?.[1] ?? NaN)
    const before = await count()
    await rt.emitToolCall('read_file', { path: 'a' }, async () => ({ result: 'ok' }))
    expect(await count()).toBe(before + 1)
  })
})
