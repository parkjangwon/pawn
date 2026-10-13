import { afterEach, describe, expect, it } from 'vitest'
import { ModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { useModsUiStore } from '../mods/uiStore'

let renders = 0
let seq = 0

function bandMod(tag: string): string {
  return [
    'let n = 0',
    'export function register(on) {',
    "  on('ui.render', { component: 'AbovePrompt' }, async (api, e, next) => {",
    '    n += 1',
    '    globalThis.__aboveRenders = (globalThis.__aboveRenders || 0) + 1',
    "    await new Promise((r) => setTimeout(r, 5))",
    "    return next({ ...e, props: { ...e.props, plugin: api.plugin.name, tree: 'draw ' + n } })",
    '  })',
    '}',
    `// ${tag}`
  ].join('\n')
}

const g = globalThis as { __aboveRenders?: number }

describe('AbovePrompt render coalescing', () => {
  afterEach(() => {
    __resetModRuntimeForTests()
    useModsUiStore.getState().clearSessionUi()
    g.__aboveRenders = 0
  })

  it('folds a burst of requests into one draw', async () => {
    const rt = new ModRuntime()
    await rt.load([{ id: 'b@t', name: 'band', root: '/tmp/b', tier: 'user', sources: [bandMod(`a${++seq}`)] }])
    g.__aboveRenders = 0
    await Promise.all([rt.requestAbovePromptRender(), rt.requestAbovePromptRender(), rt.requestAbovePromptRender()])
    renders = g.__aboveRenders || 0
    expect(renders).toBe(1)
    expect(useModsUiStore.getState().abovePrompts).toHaveLength(1)
  })

  it('runs one more draw for requests made during a draw, and ends on the newest tree', async () => {
    const rt = new ModRuntime()
    await rt.load([{ id: 'b@t', name: 'band', root: '/tmp/b', tier: 'user', sources: [bandMod(`b${++seq}`)] }])
    g.__aboveRenders = 0
    const first = rt.requestAbovePromptRender()
    await new Promise((r) => setTimeout(r, 1))
    void rt.requestAbovePromptRender()
    void rt.requestAbovePromptRender()
    await first
    await rt.requestAbovePromptRender()
    expect(g.__aboveRenders).toBe(3)
    const tree = useModsUiStore.getState().abovePrompts[0]?.tree as string
    expect(tree).toMatch(/^draw \d+$/)
    expect(Number(tree.split(' ')[1])).toBeGreaterThanOrEqual(3)
  })
})
