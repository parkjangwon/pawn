// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import ModsChrome from '../ModsChrome'
import { useModsUiStore } from '../../agent/mods/uiStore'
import { ensureModsLoaded, __resetModsClientForTests } from '../../agent/mods/client'
import { __resetModRuntimeForTests } from '../../agent/mods/runtime'

// ModsChrome loads mods on mount (ensureModsLoaded), and a load starts by
// clearing session UI. Mod chrome must therefore come from a loaded mod, not
// from store state seeded before render.
const bandMod = [
  'export function register(on) {',
  "  on('ui.render', { component: 'AbovePrompt' }, (api, e, next) =>",
  "    next({ ...e, props: { ...e.props, plugin: api.plugin.name, tree: { type: 'Text', props: { text: 'band body' } } } }))",
  '}',
  '// ModsChrome.test band'
].join('\n')

beforeEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  useModsUiStore.getState().clearSessionUi()
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete (window as { api?: unknown }).api
})

describe('ModsChrome v3 chrome', () => {
  it('renders an AbovePrompt band inside a Card (pawn-card)', async () => {
    const loadSources = vi.fn(async () => ({
      ok: true,
      sources: [{ id: 'demo@1', name: 'demo', root: '/tmp/demo', tier: 'user', sources: [bandMod] }]
    }))
    ;(window as { api?: unknown }).api = { mods: { loadSources } }
    render(<ModsChrome />)
    const band = await screen.findByRole('region', { name: 'Mod prompt band' })
    expect(loadSources).toHaveBeenCalled()
    expect(band.classList.contains('mods-chrome-above')).toBe(true)
    expect(band.classList.contains('pawn-card')).toBe(true)
    expect(screen.getByText('band body')).toBeInTheDocument()
  })

  it('renders panes inside the .mods-chrome-dock container', async () => {
    const { container } = render(<ModsChrome />)
    // Let the mount-time load (no mods here) settle, then open a pane the way
    // a mod would after load.
    await act(async () => {
      await ensureModsLoaded({ sessionId: 'pending', cwd: '', projectPath: null })
    })
    act(() => {
      useModsUiStore.getState().openPane({
        id: 'pane-1',
        title: 'Demo panel',
        plugin: 'demo',
        placement: 'docked',
        tree: { type: 'Text', props: { text: 'pane body' } }
      })
    })
    const dock = container.querySelector('.mods-chrome-dock')
    expect(dock).not.toBeNull()
    expect(dock?.getAttribute('role')).toBe('group')
    const pane = screen.getByRole('complementary', { name: 'Demo panel' })
    expect(dock?.contains(pane)).toBe(true)
    expect(pane.classList.contains('mods-chrome-pane')).toBe(true)
    expect(screen.getByText('pane body')).toBeInTheDocument()
  })

  it('renders nothing when there is no mod UI state', () => {
    const { container } = render(<ModsChrome />)
    expect(container.textContent).toBe('')
  })

  it("variant='home' still loads mods but renders no chip or band; default does", async () => {
    const loadSources = vi.fn(async () => ({
      ok: true,
      sources: [{ id: 'demo@1', name: 'demo', root: '/tmp/demo', tier: 'user', sources: [bandMod] }]
    }))
    ;(window as { api?: unknown }).api = { mods: { loadSources } }
    const home = render(<ModsChrome variant="home" />)
    await vi.waitFor(() => expect(loadSources).toHaveBeenCalled())
    await act(async () => {
      await ensureModsLoaded({ sessionId: 'pending', cwd: '', projectPath: null })
    })
    expect(home.container.textContent).toBe('')
    expect(screen.queryByText('demo active')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Mod prompt band' })).toBeNull()
    home.unmount()

    render(<ModsChrome />)
    expect(await screen.findByRole('region', { name: 'Mod prompt band' })).toBeInTheDocument()
    expect(await screen.findByText('demo active')).toBeInTheDocument()
  })
})
