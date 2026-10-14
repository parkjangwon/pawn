// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  ModHeaderSlots,
  ModSettingsNav,
  ModSettingsPage,
  ModSidebarSlots,
  ModStatusbarSlots,
  ModToolbarSlots
} from '../ModSlots'
import { useModsUiStore } from '../../agent/mods/uiStore'
import { getModRuntime, __resetModRuntimeForTests } from '../../agent/mods/runtime'
import { __resetModsClientForTests } from '../../agent/mods/client'
import { deriveModCapabilities } from '../../agent/mods/capabilities'

type Press = { plugin: string; id: string; slot?: string; component?: string; value?: unknown }
const g = globalThis as { __slotPresses?: Press[] }

/** `$` inside template strings trips the parser; write __API__ instead. */
function mod(lines: string[]): string {
  return lines.join('\n').replace(/__API__/g, '$')
}

// The runtime caches a module by its source text, so `n` carries over between tests.
const slotsMod = mod([
  'let n = 0',
  'function draw(__API__) {',
  "  __API__.slot.sidebar({ id: 'side', title: 'Demo side', tree: [{ type: 'Text', props: { text: 'count ' + n } }, { type: 'Button', props: { id: 'bump', text: 'Bump' } }] })",
  "  __API__.slot.header({ id: 'hdr', label: 'Hdr' })",
  "  __API__.slot.toolbar({ id: 'tb', label: 'Tb' })",
  "  __API__.slot.settings({ id: 'prefs', title: 'Demo prefs', tree: { type: 'Input', props: { id: 'note', placeholder: 'Note' } } })",
  "  __API__.slot.statusbar({ id: 'st', text: 'n=' + n })",
  '}',
  'export function register(on) {',
  "  on('session.start', async (__API__, e, next) => { draw(__API__); return next(e) })",
  "  on('ui.press', { plugin: 'demo' }, async (__API__, e, next) => {",
  '    globalThis.__slotPresses.push(e)',
  "    if (e.id === 'bump') { n += 1; draw(__API__) }",
  '    return next(e)',
  '  })',
  "  on('ui.input', { plugin: 'demo' }, async (__API__, e, next) => { globalThis.__slotPresses.push(e); return next(e) })",
  '}'
])

async function loadDemo(source = slotsMod, name = 'demo'): Promise<void> {
  const rt = getModRuntime()
  rt.setContext({ sessionId: 's1', cwd: '/tmp' })
  await act(async () => {
    await rt.load([{ id: `${name}@1`, name, root: `/tmp/${name}`, tier: 'user', sources: [source] }])
  })
}

beforeEach(() => {
  g.__slotPresses = []
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  useModsUiStore.getState().clearSessionUi()
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete g.__slotPresses
})

describe('mod UI slots', () => {
  it('sidebar: draws a titled section, collapses on title click, and routes tree buttons with slot', async () => {
    render(<ModSidebarSlots />)
    await loadDemo()
    expect(screen.getByText('count 0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bump' }))
    await waitFor(() => expect(screen.getByText('count 1')).toBeInTheDocument())
    expect(g.__slotPresses?.[0]).toMatchObject({ plugin: 'demo', id: 'bump', slot: 'sidebar' })
    // Re-registering the same id replaced the section instead of adding one.
    expect(document.querySelectorAll('.mod-slot-sidebar')).toHaveLength(1)
    const title = screen.getByRole('button', { name: /Demo side/ })
    expect(title).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(title)
    expect(title).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('count 1')).toBeNull()
  })

  it('header: a button that sends ui.press with slot header to its mod', async () => {
    render(<ModHeaderSlots />)
    await loadDemo()
    fireEvent.click(screen.getByRole('button', { name: 'Hdr' }))
    await waitFor(() => expect(g.__slotPresses).toContainEqual(expect.objectContaining({ id: 'hdr', slot: 'header', plugin: 'demo' })))
  })

  it('toolbar: a composer button, hidden on the home screen', async () => {
    const { rerender } = render(<ModToolbarSlots hidden />)
    await loadDemo()
    expect(screen.queryByRole('button', { name: 'Tb' })).toBeNull()
    rerender(<ModToolbarSlots />)
    fireEvent.click(screen.getByRole('button', { name: 'Tb' }))
    await waitFor(() => expect(g.__slotPresses).toContainEqual(expect.objectContaining({ id: 'tb', slot: 'toolbar' })))
  })

  it('settings: a nav entry under Mods opens the page, and its Input reports with slot settings', async () => {
    render(
      <>
        <ModSettingsNav />
        <ModSettingsPage />
      </>
    )
    await loadDemo()
    expect(screen.getByText('Mods')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Demo prefs/ }))
    const input = screen.getByPlaceholderText('Note')
    expect(screen.getByRole('heading', { name: 'Demo prefs' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(g.__slotPresses).toContainEqual(expect.objectContaining({ id: 'note', slot: 'settings', value: 'hi' })))
  })

  it('statusbar: a text item that presses its mod and updates on redraw', async () => {
    render(<ModStatusbarSlots />)
    await loadDemo()
    fireEvent.click(screen.getByRole('button', { name: /^n=\d+$/ }))
    await waitFor(() => expect(g.__slotPresses).toContainEqual(expect.objectContaining({ id: 'st', slot: 'statusbar' })))
  })

  it('keeps slots across a chat switch and drops them when the session UI is cleared', async () => {
    render(<ModStatusbarSlots />)
    await loadDemo()
    act(() => useModsUiStore.getState().clearChatUi())
    expect(screen.getByRole('button', { name: /^n=\d+$/ })).toBeInTheDocument()
    act(() => useModsUiStore.getState().clearSessionUi())
    expect(screen.queryByRole('button', { name: /^n=\d+$/ })).toBeNull()
  })

  it('remove() and unload clear a slot; list() returns only own slots', async () => {
    const source = mod([
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    __API__.slot.statusbar({ id: 'a', text: 'A' })",
      "    __API__.slot.statusbar({ id: 'b', text: 'B' })",
      "    __API__.slot.remove({ slot: 'statusbar', id: 'a' })",
      '    globalThis.__slotPresses.push({ listed: __API__.slot.list().map((s) => s.id) })',
      '    return next(e)',
      '  })',
      '}'
    ])
    render(<ModStatusbarSlots />)
    await loadDemo(source, 'rm')
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument()
    expect(g.__slotPresses).toContainEqual({ listed: ['b'] })
    await act(async () => {
      await getModRuntime().unload()
    })
    expect(screen.queryByRole('button', { name: 'B' })).toBeNull()
  })

  it('refuses a slot whose call is not written in the source (not shown at consent)', async () => {
    // The kind is computed, so static analysis never saw `$.slot.header`.
    const source = mod([
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    const kind = ['hea', 'der'].join('')",
      "    try { __API__.slot[kind]({ id: 'x', label: 'Sneaky' }) } catch (err) { globalThis.__slotPresses.push({ refused: String(err.message) }) }",
      "    __API__.slot.statusbar({ id: 'ok', text: 'Fine' })",
      '    return next(e)',
      '  })',
      '}'
    ])
    render(
      <>
        <ModHeaderSlots />
        <ModStatusbarSlots />
      </>
    )
    await loadDemo(source, 'sneaky')
    expect(screen.queryByRole('button', { name: 'Sneaky' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fine' })).toBeInTheDocument()
    expect(g.__slotPresses).toContainEqual({ refused: expect.stringContaining('$.slot.header refused') })
  })

  it('rejects bad slot ids', async () => {
    const source = mod([
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    try { __API__.slot.statusbar({ id: 'bad id!', text: 'X' }) } catch (err) { globalThis.__slotPresses.push({ err: String(err.message) }) }",
      '    return next(e)',
      '  })',
      '}'
    ])
    await loadDemo(source, 'badid')
    expect(g.__slotPresses).toContainEqual({ err: 'Invalid slot id: bad id!' })
    expect(useModsUiStore.getState().slots).toHaveLength(0)
  })
})

describe('ui-slots-demo example', () => {
  it('registers the B1 slots (B2 kinds are covered in ModSlotsB2.test.tsx)', async () => {
    const source = readFileSync(
      resolve(__dirname, '../../../../../examples/mods/ui-slots-demo/hooks/register.js'),
      'utf8'
    )
    await loadDemo(source, 'ui-slots-demo')
    const kinds = useModsUiStore.getState().slots.map((s) => s.slot)
    for (const k of ['header', 'settings', 'sidebar', 'statusbar', 'toolbar']) expect(kinds).toContain(k)
    const info = getModRuntime().getLoaded().find((m) => m.name === 'ui-slots-demo')
    expect(deriveModCapabilities(info?.hooks || [], info?.calls || []).map((c) => c.id)).toEqual([
      'ui',
      'sidebar',
      'toolbar',
      'settingsPage',
      'statusbar',
      'palette',
      'shortcuts',
      'messages'
    ])
  })
})

describe('slot capabilities', () => {
  it.each([
    ['$.slot.sidebar', 'sidebar'],
    ['$.slot.panel', 'sidebar'],
    ['$.slot.header', 'toolbar'],
    ['$.slot.toolbar', 'toolbar'],
    ['$.slot.settings', 'settingsPage'],
    ['$.slot.statusbar', 'statusbar']
  ])('%s needs the %s capability', (call, id) => {
    expect(deriveModCapabilities([], [call]).map((c) => c.id)).toEqual([id])
  })

  it('remove/list alone need no capability', () => {
    expect(deriveModCapabilities([], ['$.slot.remove', '$.slot.list'])).toEqual([])
  })
})
