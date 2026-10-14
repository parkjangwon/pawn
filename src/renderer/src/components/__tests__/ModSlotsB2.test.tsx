// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModMessageDecor, ModShortcutListener, useModPaletteSlots } from '../ModSlots'
import { useModsUiStore } from '../../agent/mods/uiStore'
import { getModRuntime, __resetModRuntimeForTests } from '../../agent/mods/runtime'
import { __resetModsClientForTests } from '../../agent/mods/client'
import { deriveModCapabilities } from '../../agent/mods/capabilities'
import { __resetMessageRenderCacheForTests, messageDecorations } from '../../agent/mods/messageRender'
import { normalizeShortcut, shortcutsConflict } from '../../agent/mods/shortcuts'
import { DEFAULT_KEYBINDINGS, useKeybindingsStore } from '../../stores/keybindings'

type Rec = Record<string, unknown>
const g = globalThis as { __b2?: Rec[] }

function mod(lines: string[]): string {
  return lines.join('\n').replace(/__API__/g, '$')
}

async function load(source: string, name: string, sessionId = 's1'): Promise<void> {
  const rt = getModRuntime()
  rt.setContext({ sessionId, cwd: '/tmp' })
  await act(async () => {
    await rt.load([{ id: `${name}@1`, name, root: `/tmp/${name}`, tier: 'user', sources: [source] }])
  })
}

async function loadMany(mods: Array<{ name: string; source: string }>): Promise<void> {
  const rt = getModRuntime()
  rt.setContext({ sessionId: 's1', cwd: '/tmp' })
  await act(async () => {
    await rt.load(mods.map((m) => ({ id: `${m.name}@1`, name: m.name, root: `/tmp/${m.name}`, tier: 'user' as const, sources: [m.source] })))
  })
}

function shortcutMod(name: string, keys: string): string {
  return mod([
    'export function register(on) {',
    "  on('session.start', async (__API__, e, next) => {",
    `    try { __API__.slot.shortcut({ id: 'go', keys: '${keys}', title: 'Go' }) } catch (err) { globalThis.__b2.push({ plugin: '${name}', err: String(err.message) }) }`,
    '    return next(e)',
    '  })',
    `  on('ui.press', { plugin: '${name}' }, async (__API__, e, next) => { globalThis.__b2.push(e); return next(e) })`,
    '}'
  ])
}

beforeEach(() => {
  g.__b2 = []
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  __resetMessageRenderCacheForTests()
  useModsUiStore.getState().clearSessionUi()
  useKeybindingsStore.setState({ bindings: { ...DEFAULT_KEYBINDINGS } })
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete g.__b2
})

describe('$.slot.palette', () => {
  const paletteMod = mod([
    'export function register(on) {',
    "  on('session.start', async (__API__, e, next) => { __API__.slot.palette({ id: 'hi', title: 'Say hi', hint: 'demo' }); return next(e) })",
    "  on('ui.press', { plugin: 'pal' }, async (__API__, e, next) => { globalThis.__b2.push(e); return next(e) })",
    '}'
  ])

  function Probe(): React.JSX.Element {
    const items = useModPaletteSlots()
    return <ul>{items.map((i) => <li key={i.id}>{`${i.plugin}:${i.title}:${i.hint}`}</li>)}</ul>
  }

  it('registers an entry the palette reads, owned by the mod', async () => {
    render(<Probe />)
    await load(paletteMod, 'pal')
    expect(screen.getByText('pal:Say hi:demo')).toBeInTheDocument()
  })

  it('runs through the real CommandPalette and sends ui.press slot palette', async () => {
    const { default: CommandPalette } = await import('../CommandPalette')
    await load(paletteMod, 'pal')
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />)
    expect(screen.getByText('Mods')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Say hi'))
    await waitFor(() => expect(g.__b2).toContainEqual(expect.objectContaining({ plugin: 'pal', id: 'hi', slot: 'palette' })))
  })

  it('is refused when $.slot.palette is not written in source', async () => {
    const sneaky = mod([
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    try { __API__.slot['pal' + 'ette']({ id: 'x', title: 'X' }) } catch (err) { globalThis.__b2.push({ err: String(err.message) }) }",
      '    return next(e)',
      '  })',
      '}'
    ])
    await load(sneaky, 'sneaky')
    expect(g.__b2).toContainEqual({ err: expect.stringContaining('$.slot.palette refused') })
    expect(useModsUiStore.getState().slots).toHaveLength(0)
  })
})

describe('$.slot.shortcut', () => {
  it('normalizes chords and treats Mod/Meta/Ctrl like the app does', () => {
    expect(normalizeShortcut('shift+cmd+u')).toBe('Mod+Shift+U')
    expect(normalizeShortcut('Ctrl+')).toBeNull()
    expect(normalizeShortcut('Shift')).toBeNull()
    expect(shortcutsConflict('Mod+K', 'Meta+K')).toBe(true)
    expect(shortcutsConflict('Ctrl+K', 'Meta+K')).toBe(true)
    expect(shortcutsConflict('Mod+Shift+K', 'Meta+K')).toBe(false)
  })

  it('fires the mod on its chord and sends ui.press slot shortcut', async () => {
    render(<ModShortcutListener />)
    await load(shortcutMod('sc', 'Mod+Shift+U'), 'sc')
    expect(useModsUiStore.getState().slots).toContainEqual(expect.objectContaining({ slot: 'shortcut', keys: 'Mod+Shift+U' }))
    fireEvent.keyDown(window, { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(g.__b2).toContainEqual(expect.objectContaining({ plugin: 'sc', id: 'go', slot: 'shortcut' })))
  })

  it('refuses a chord the app owns and reports it', async () => {
    await load(shortcutMod('clash', 'Mod+K'), 'clash')
    expect(g.__b2).toContainEqual({ plugin: 'clash', err: expect.stringContaining('open-command-palette') })
    expect(useModsUiStore.getState().slots.filter((s) => s.slot === 'shortcut')).toHaveLength(0)
    expect(useModsUiStore.getState().logs.map((l) => l.text).join('\n')).toContain('conflicts with the app shortcut')
    expect(useModsUiStore.getState().timeline).toContainEqual(expect.objectContaining({ kind: 'conflict', plugin: 'clash' }))
  })

  it('refuses reserved editing chords (Mod+C)', async () => {
    await load(shortcutMod('copy', 'Ctrl+C'), 'copy')
    expect(g.__b2).toContainEqual({ plugin: 'copy', err: expect.stringContaining('reserved by the app') })
  })

  it('the second mod asking for the same chord is refused; the first keeps it', async () => {
    render(<ModShortcutListener />)
    await loadMany([
      { name: 'first', source: shortcutMod('first', 'Alt+Shift+L') },
      { name: 'second', source: shortcutMod('second', 'Shift+Alt+L') }
    ])
    expect(g.__b2).toContainEqual({ plugin: 'second', err: expect.stringContaining('conflicts with mod first') })
    fireEvent.keyDown(window, { key: 'L', code: 'KeyL', altKey: true, shiftKey: true })
    await waitFor(() => expect(g.__b2).toContainEqual(expect.objectContaining({ plugin: 'first', slot: 'shortcut' })))
    expect(g.__b2?.some((e) => e.plugin === 'second' && e.slot === 'shortcut')).toBe(false)
  })

  it('a user rebinding later wins over the mod: the app chord never reaches it', async () => {
    render(<ModShortcutListener />)
    await load(shortcutMod('later', 'Mod+Shift+U'), 'later')
    act(() => useKeybindingsStore.setState({ bindings: { ...DEFAULT_KEYBINDINGS, 'new-session': 'Meta+Shift+U' } }))
    fireEvent.keyDown(window, { key: 'U', code: 'KeyU', metaKey: true, shiftKey: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(g.__b2?.some((e) => e.slot === 'shortcut')).toBe(false)
  })

  it('a chord without Mod/Ctrl/Alt does not fire while typing in a field', async () => {
    render(<><ModShortcutListener /><input aria-label="field" /></>)
    await load(shortcutMod('plain', 'Shift+G'), 'plain')
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'G', code: 'KeyG', shiftKey: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(g.__b2?.some((e) => e.slot === 'shortcut')).toBe(false)
    fireEvent.keyDown(window, { key: 'G', code: 'KeyG', shiftKey: true })
    await waitFor(() => expect(g.__b2).toContainEqual(expect.objectContaining({ slot: 'shortcut' })))
  })
})

describe('message.render', () => {
  const decorMod = mod([
    'let calls = 0',
    'export function register(on) {',
    "  on('message.render', async (__API__, e, next) => {",
    '    calls += 1',
    "    globalThis.__b2.push({ render: e.messageId, sid: e.sessionId, calls })",
    "    const el = __API__.ui.resolve({})",
    '    return next({ ...e, props: {',
    "      badges: [...e.props.badges, { id: 'len', text: e.text.length + ' chars', tone: 'success' }],",
    "      actions: [...e.props.actions, { id: 'act', label: 'Do it' }],",
    "      blocks: [...e.props.blocks, { id: 'blk', tree: el.Text({ text: 'block for ' + e.sessionId }) }]",
    '    } })',
    '  })',
    "  on('ui.press', { plugin: 'deco' }, async (__API__, e, next) => { globalThis.__b2.push(e); return next(e) })",
    '}'
  ])

  it('adds badges, actions and blocks, stamped with the owning mod; actions carry chat and message ids', async () => {
    await load(decorMod, 'deco')
    render(<ModMessageDecor messageId="m1" role="assistant" text="hello" sessionId="s1" />)
    await waitFor(() => expect(screen.getByText('5 chars')).toBeInTheDocument())
    expect(screen.getByText('5 chars')).toHaveAttribute('data-plugin', 'deco')
    expect(screen.getByText('5 chars').className).toContain('tone-success')
    expect(screen.getByText('block for s1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))
    await waitFor(() =>
      expect(g.__b2).toContainEqual(expect.objectContaining({ plugin: 'deco', id: 'act', slot: 'message', messageId: 'm1', sessionId: 's1' }))
    )
  })

  it('is per chat: the event carries the row\'s chat, not the chat on screen', async () => {
    await load(decorMod, 'deco', 'visible')
    render(<ModMessageDecor messageId="m9" role="assistant" text="x" sessionId="background" />)
    await waitFor(() => expect(screen.getByText('block for background')).toBeInTheDocument())
    expect(g.__b2).toContainEqual(expect.objectContaining({ render: 'm9', sid: 'background' }))
  })

  it('caches per message: re-rendering the same row does not call the mod again', async () => {
    await load(decorMod, 'deco')
    const { rerender } = render(<ModMessageDecor messageId="m1" role="assistant" text="hello" sessionId="s1" />)
    await waitFor(() => expect(screen.getByText('5 chars')).toBeInTheDocument())
    for (let i = 0; i < 5; i++) rerender(<ModMessageDecor messageId="m1" role="assistant" text="hello" sessionId="s1" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(g.__b2?.filter((e) => e.render === 'm1')).toHaveLength(1)
    // Edited text is a new render.
    rerender(<ModMessageDecor messageId="m1" role="assistant" text="hello!" sessionId="s1" />)
    await waitFor(() => expect(screen.getByText('6 chars')).toBeInTheDocument())
  })

  it('a redraw (invalidate) re-asks the mod', async () => {
    await load(decorMod, 'deco')
    render(<ModMessageDecor messageId="m1" role="assistant" text="hello" sessionId="s1" />)
    await waitFor(() => expect(screen.getByText('5 chars')).toBeInTheDocument())
    act(() => useModsUiStore.getState().invalidate())
    await waitFor(() => expect(g.__b2?.filter((e) => e.render === 'm1')).toHaveLength(2))
  })

  it('without a message.render hook nothing is emitted and nothing is drawn', async () => {
    await load(mod(['export function register(on) {', "  on('session.start', async (__API__, e, next) => next(e))", '}']), 'quiet')
    const { container } = render(<ModMessageDecor messageId="m1" role="assistant" text="hello" sessionId="s1" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('refuses on("message.render") when the event name is not a literal in source', async () => {
    const sneaky = mod([
      "const ev = ['message', 'render'].join('.')",
      'export function register(on) {',
      "  try { on(ev, async (__API__, e, next) => next(e)) } catch (err) { globalThis.__b2.push({ err: String(err.message) }) }",
      '}'
    ])
    await load(sneaky, 'sneaky')
    expect(g.__b2).toContainEqual({ err: expect.stringContaining('message.render refused') })
    expect(getModRuntime().hasHooks('message.render')).toBe(false)
  })

  it('a later mod cannot take over an earlier mod\'s badge id', async () => {
    const thief = mod([
      'export function register(on) {',
      "  on('message.render', async (__API__, e, next) => next({ ...e, props: { ...e.props, badges: e.props.badges.map((b) => ({ ...b, text: 'stolen' })) } }))",
      '}'
    ])
    await loadMany([
      { name: 'deco', source: decorMod },
      { name: 'thief', source: thief }
    ])
    const out = await messageDecorations({ messageId: 'm1', role: 'assistant', text: 'hi', sessionId: 's1', generation: 0, runtimeGeneration: 0 })
    expect(out.badges).toEqual([expect.objectContaining({ id: 'len', plugin: 'deco' })])
  })

  it('a throwing hook leaves the message undecorated (no crash)', async () => {
    const bad = mod(['export function register(on) {', "  on('message.render', async () => { throw new Error('boom') })", '}'])
    await load(bad, 'bad')
    const { container } = render(<ModMessageDecor messageId="m1" role="assistant" text="hello" sessionId="s1" />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
  })
})

describe('B2 capabilities', () => {
  it.each([
    [[], ['$.slot.palette'], 'palette'],
    [[], ['$.slot.shortcut'], 'shortcuts'],
    [['message.render'], [], 'messages']
  ])('%j %j needs %s', (hooks, calls, id) => {
    expect(deriveModCapabilities(hooks as string[], calls as string[]).map((c) => c.id)).toEqual([id])
  })
})

describe('ui-slots-demo example (B2)', () => {
  it('adds palette, shortcut and message.render, and asks for those capabilities', async () => {
    const source = readFileSync(resolve(__dirname, '../../../../../examples/mods/ui-slots-demo/hooks/register.js'), 'utf8')
    await load(source, 'ui-slots-demo')
    const kinds = useModsUiStore.getState().slots.map((s) => s.slot).sort()
    expect(kinds).toEqual(['header', 'palette', 'settings', 'shortcut', 'sidebar', 'statusbar', 'toolbar'])
    const info = getModRuntime().getLoaded().find((m) => m.name === 'ui-slots-demo')
    expect(deriveModCapabilities(info?.hooks || [], info?.calls || []).map((c) => c.id)).toEqual([
      'ui', 'sidebar', 'toolbar', 'settingsPage', 'statusbar', 'palette', 'shortcuts', 'messages'
    ])
    render(<ModMessageDecor messageId="a1" role="assistant" text="one two three" sessionId="s1" />)
    await waitFor(() => expect(screen.getByText('3 words')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(screen.getByText('Pinned in this chat')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument()
  })
})
