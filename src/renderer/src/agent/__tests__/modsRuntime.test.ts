import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPromptRewrite, getModRuntime, ModRuntime, MOD_PROMPT_CAP, __resetModRuntimeForTests } from '../mods/runtime'
import { getModToolDefinitions } from '../mods/catalog'
import { __resetModsClientForTests } from '../mods/client'
import { useModsUiStore } from '../mods/uiStore'

/** Avoid `$` inside JS template literals (oxc parse edge cases). */
function withDollar(src: string): string {
  return src.replace(/__API__/g, '$')
}

function firstModSource(): string {
  return withDollar(
    [
      'let calls = 0',
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      '    await __API__.command.register({',
      "      name: 'tally',",
      "      description: 'Show how many tool calls',",
      '    })',
      '    return next(e)',
      '  })',
      "  on('tool.call', async (__API__, e, next) => {",
      '    calls += 1',
      "    __API__.ui.invalidate('ui.render')",
      '    return next(e)',
      '  })',
      "  on('command.run', { command: 'tally' }, async () => {",
      "    return { text: 'Claude has made ' + calls + ' tool calls since this mod loaded' }",
      '  })',
      "  on('ui.render', { component: 'Spinner' }, async (__API__, e, next) => {",
      "    return next({ ...e, props: { ...e.props, suffix: ' · tool calls: ' + calls + '…' } })",
      '  })',
      '}'
    ].join('\n')
  )
}

describe('ModRuntime (Claude Code first-mod)', () => {
  beforeEach(() => {
    __resetModRuntimeForTests()
    __resetModsClientForTests()
    useModsUiStore.getState().clearSessionUi()
  })
  afterEach(() => {
    __resetModRuntimeForTests()
    __resetModsClientForTests()
  })

  it('counts tool.call, answers /tally, and rewrites Spinner.suffix', async () => {
    const rt = new ModRuntime()
    rt.setContext({ sessionId: 's1', cwd: '/tmp' })
    await rt.load([
      {
        id: 'first-mod@test',
        name: 'first-mod',
        root: '/tmp/first-mod',
        tier: 'user',
        sources: [firstModSource()]
      }
    ])

    expect(rt.getCommands().some((c) => c.name === 'tally')).toBe(true)

    await rt.emitToolCall('read_file', { path: 'a.ts' }, async () => ({ result: 'ok' }))
    await rt.emitToolCall('read_file', { path: 'b.ts' }, async () => ({ result: 'ok' }))

    const answer = await rt.emitCommandRun('tally', '')
    expect(answer.handled).toBe(true)
    expect(answer.text).toBe('Claude has made 2 tool calls since this mod loaded')

    const suffix = await rt.refreshSpinnerSuffix()
    expect(suffix).toContain('tool calls: 2')
    expect(useModsUiStore.getState().spinnerSuffix).toContain('tool calls: 2')
  })

  it('lets a mod deny a tool.call without running core', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'guard@test',
        name: 'guard',
        root: '/tmp/guard',
        tier: 'user',
        sources: [
        [
          'export function register(on) {',
          "  on('tool.call', { tool: 'shell_exec' }, async () => ({ deny: 'no shells' }))",
          '}'
        ].join('\n')
        ]
      }
    ])
    let ran = false
    const out = await rt.emitToolCall('shell_exec', { command: 'rm -rf /' }, async () => {
      ran = true
      return { result: 'should not run' }
    })
    expect(ran).toBe(false)
    expect(out.deny).toBe('no shells')
  })

  it('rewrites prompt.submit text via next()', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'trim@test',
        name: 'trim',
        root: '/tmp/trim',
        tier: 'user',
        sources: [withDollar(
          [
            'export function register(on) {',
            "  on('prompt.submit', async (__API__, e, next) => next({ ...e, text: e.text.trim() }))",
            '}'
          ].join('\n')
        )]
      }
    ])
    const out = await rt.emitPromptSubmit('  hello  ')
    expect(out.text).toBe('hello')
  })

  it('renders AbovePrompt tree, honors ui.press, and records conflicts', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'a@test',
        name: 'alpha',
        root: '/tmp/alpha',
        tier: 'user',
        sources: [withDollar(
          [
            'let n = 1',
            'export function register(on) {',
            "  on('tool.call', async (__API__, e, next) => next(e))",
            "  on('ui.render', { component: 'AbovePrompt' }, async (__API__, e, next) => {",
            '    const el = __API__.ui.resolve(e)',
            '    return next({',
            '      ...e,',
            '      props: {',
            '        ...e.props,',
            "        plugin: 'alpha',",
            "        tree: el.Box({ children: [el.Button({ id: 'bump', text: 'Bump ' + n })] })",
            '      }',
            '    })',
            '  })',
            "  on('ui.press', { id: 'bump' }, async (__API__, e) => {",
            '    n += 1',
            '    __API__.ui.invalidate()',
            '    return e',
            '  })',
            '}'
          ].join('\n')
        )]
      },
      {
        id: 'b@test',
        name: 'beta',
        root: '/tmp/beta',
        tier: 'user',
        sources: [
        [
          'export function register(on) {',
          "  on('tool.call', async (api, e, next) => next(e))",
          '}'
        ].join('\n')
        ]
      }
    ])

    const conflicts = rt.getConflicts()
    expect(conflicts.some((c) => c.event === 'tool.call' && c.plugins.includes('alpha') && c.plugins.includes('beta'))).toBe(
      true
    )

    const props = await rt.emitUiRender('AbovePrompt', {})
    expect(props.plugin).toBe('alpha')
    expect(JSON.stringify(props.tree)).toContain('Bump 1')
    expect(useModsUiStore.getState().abovePrompts[0]?.plugin).toBe('alpha')

    await rt.emit('ui.press', { id: 'bump', plugin: 'alpha' }, async (e) => e)
    const again = await rt.emitUiRender('AbovePrompt', {})
    expect(JSON.stringify(again.tree)).toContain('Bump 2')

    await rt.emitToolCall('read_file', { path: 'x' }, async () => ({ result: 'ok' }))
    expect(useModsUiStore.getState().timeline.some((e) => e.kind === 'conflict')).toBe(true)
  })

  it('keeps the tail of a long prompt when the mod echoes the capped text', () => {
    const original = 'a'.repeat(MOD_PROMPT_CAP) + 'TAIL'
    const seen = original.slice(0, MOD_PROMPT_CAP)
    expect(applyPromptRewrite(original, seen)).toBe(original)
    expect(applyPromptRewrite(original, 'rewritten')).toBe('rewritten')
    expect(applyPromptRewrite('hello', 'hello')).toBe('hello')
  })

  it('registers a tool handler and reads env set by the mod', async () => {
    const rt = getModRuntime()
    await rt.load([
      {
        id: 'tools@test',
        name: 'tools',
        root: '/tmp/tools',
        tier: 'user',
        sources: [withDollar(
          [
            'export function register(on) {',
            "  on('session.start', async (__API__, e, next) => {",
            '    __API__.env.set("MOD_NOTE", "kept")',
            '    await __API__.tool.register({',
            "      name: 'ping',",
            "      description: 'pong',",
            '      handler: async () => "pong"',
            '    })',
            '    return next(e)',
            '  })',
            "  on('command.run', { command: 'env' }, async (__API__) => ({ text: __API__.env.get('MOD_NOTE') || '' }))",
            '}'
          ].join('\n')
        )]
      }
    ])
    expect(rt.getTools()[0]?.fullName).toBe('mcp__tools__ping')
    expect(await rt.getTools()[0]?.handler?.({})).toBe('pong')
    expect(getModToolDefinitions().some((t) => t.name === 'mcp__tools__ping')).toBe(true)
    const env = await rt.emitCommandRun('env', '')
    expect(env.text).toBe('kept')
  })

  it('loads every listed hooks.json module and keeps the mod alive if one fails', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'multi@test',
        name: 'multi',
        root: '/tmp/multi',
        tier: 'user',
        sources: [
          withDollar(
            [
              'export function register(on) {',
              "  on('tool.call', async (__API__, e, next) => next(e))",
              '}'
            ].join('\n')
          ),
          [
            'export function register(on) {',
            "  on('command.run', { command: 'second' }, async () => ({ text: 'from second' }))",
            '}'
          ].join('\n')
        ]
      }
    ])
    expect(rt.getActiveMods().map((m) => m.name)).toContain('multi')
    expect(rt.getLoaded()[0]?.hooks.sort()).toEqual(['command.run', 'tool.call'])

    const answer = await rt.emitCommandRun('second', '')
    expect(answer.text).toBe('from second')
  })

  it('marks a mod failed with an error when no module can load', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'broken@test',
        name: 'broken',
        root: '/tmp/broken',
        tier: 'user',
        sources: ['export function register(on { // syntax error']
      }
    ])
    const info = rt.getLoaded()[0]
    expect(info?.enabled).toBe(false)
    expect(info?.error).toBeTruthy()
    expect(rt.getActiveMods()).toHaveLength(0)
  })

  it('ignores a stale next() so the core cannot run twice', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'late@test',
        name: 'late',
        root: '/tmp/late',
        tier: 'user',
        sources: [
          withDollar(
            [
              'export function register(on) {',
              "  on('tool.call', async (__API__, e, next) => {",
              "    setTimeout(() => { void next(e) }, 30)",
              '    return next(e)',
              '  })',
              '}'
            ].join('\n')
          )
        ]
      }
    ])
    let coreRuns = 0
    const out = await rt.emitToolCall('read_file', { path: 'x' }, async () => {
      coreRuns += 1
      return { result: 'core' }
    })
    expect(out.handled).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(coreRuns).toBe(1)
  })

  it('a late next() cannot re-run the chain after the hook answered', async () => {
    const rt = new ModRuntime()
    await rt.load([
      {
        id: 'deny@test',
        name: 'deny',
        root: '/tmp/deny',
        tier: 'user',
        sources: [
          withDollar(
            [
              'export function register(on) {',
              "  on('tool.call', async (__API__, e, next) => {",
              '    setTimeout(() => { void next(e) }, 30)',
              "    return { deny: 'no' }",
              '  })',
              '}'
            ].join('\n')
          )
        ]
      }
    ])
    let coreRuns = 0
    const out = await rt.emitToolCall('read_file', { path: 'x' }, async () => {
      coreRuns += 1
      return { result: 'core' }
    })
    expect(out.deny).toBe('no')
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(coreRuns).toBe(0)
  })

  it('stacks AbovePrompt bands and emits session.end on unload', async () => {
    const rt = new ModRuntime()
    const g = globalThis as { __modEnded?: boolean }
    g.__modEnded = false
    await rt.load([
      {
        id: 'a@test',
        name: 'alpha',
        root: '/tmp/alpha',
        tier: 'user',
        sources: [withDollar(
          [
            'export function register(on) {',
            "  on('ui.render', { component: 'AbovePrompt' }, async (__API__, e, next) => next({",
            '    ...e, props: { ...e.props, plugin: "alpha", tree: { type: "Text", props: { text: "A" } } }',
            '  }))',
            '}'
          ].join('\n')
        )]
      },
      {
        id: 'b@test',
        name: 'beta',
        root: '/tmp/beta',
        tier: 'user',
        sources: [
        [
          'export function register(on) {',
          "  on('ui.render', { component: 'AbovePrompt' }, async (api, e, next) => next({",
          '    ...e, props: { ...e.props, plugin: "beta", tree: { type: "Text", props: { text: "B" } } }',
          '  }))',
          "  on('session.end', () => { globalThis.__modEnded = true })",
          '}'
        ].join('\n')
        ]
      }
    ])
    await rt.emitUiRender('AbovePrompt', {})
    const bands = useModsUiStore.getState().abovePrompts
    expect(bands.map((b) => b.plugin)).toEqual(['alpha', 'beta'])
    await rt.unload()
    expect(g.__modEnded).toBe(true)
  })
})

describe('deriveModRisk', () => {
  it('marks process/network high and tools/files medium', async () => {
    const { deriveModRisk } = await import('../mods/capabilities')
    expect(deriveModRisk(['ui.render'], ['$.ui.toast'])).toBe('low')
    expect(deriveModRisk(['tool.call'], [])).toBe('medium')
    expect(deriveModRisk([], ['$.process.exec'])).toBe('high')
  })
})
