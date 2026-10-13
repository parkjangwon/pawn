import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, it } from 'vitest'
import { getModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { formatModSpinnerSuffix, watchModSpinnerSuffix } from '../mods/spinner'
import { useModsUiStore } from '../mods/uiStore'

const REGISTER_JS = readFileSync(
  join(fileURLToPath(new URL('../../../../..', import.meta.url)), 'examples/mods/first-mod/hooks/register.js'),
  'utf-8'
)

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('formatModSpinnerSuffix', () => {
  it('drops the mod’s own leading separator so the line has one " · "', () => {
    expect(formatModSpinnerSuffix(' · tool calls: 2…')).toBe('tool calls: 2…')
    expect(formatModSpinnerSuffix('— busy')).toBe('busy')
    expect(formatModSpinnerSuffix('plain')).toBe('plain')
    expect(formatModSpinnerSuffix('  ·  ')).toBe('')
    expect(formatModSpinnerSuffix('')).toBe('')
  })
})

describe('watchModSpinnerSuffix', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    stop = null
    __resetModRuntimeForTests()
    useModsUiStore.getState().clearSessionUi()
  })

  it('has a suffix right after load and follows $.ui.invalidate, with no tool run through the executor', async () => {
    const rt = getModRuntime()
    rt.setContext({ sessionId: 's', cwd: '/tmp' })
    // Unique source per test run so the data: URL module cache gives a fresh counter.
    await rt.load([
      { id: 'first-mod@t', name: 'first-mod', root: '/tmp/fm', tier: 'user', sources: [`${REGISTER_JS}\n// ${Date.now()}`] }
    ])
    stop = watchModSpinnerSuffix()
    await settle()
    expect(useModsUiStore.getState().spinnerSuffix).toContain('tool calls: 0')

    // first-mod's tool.call hook calls $.ui.invalidate(); the core here does
    // not refresh the suffix itself (toolExecutor used to be the only caller).
    await rt.emitToolCall('read_file', { path: 'a' }, async () => ({ result: 'ok' }))
    await settle()
    expect(useModsUiStore.getState().spinnerSuffix).toContain('tool calls: 1')
  })

  it('clears the suffix when mods unload', async () => {
    const rt = getModRuntime()
    await rt.load([
      { id: 'first-mod@t', name: 'first-mod', root: '/tmp/fm', tier: 'user', sources: [`${REGISTER_JS}\n// u${Date.now()}`] }
    ])
    stop = watchModSpinnerSuffix()
    await settle()
    expect(useModsUiStore.getState().spinnerSuffix).not.toBe('')
    await rt.unload()
    await settle()
    expect(useModsUiStore.getState().spinnerSuffix).toBe('')
  })
})
