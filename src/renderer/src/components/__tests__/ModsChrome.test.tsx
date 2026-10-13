// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModsChrome from '../ModsChrome'
import { useModsUiStore } from '../../agent/mods/uiStore'

beforeEach(() => {
  useModsUiStore.getState().clearSessionUi()
})

describe('ModsChrome v3 chrome', () => {
  it('renders an AbovePrompt band inside a Card (pawn-card)', () => {
    useModsUiStore.setState({
      abovePrompts: [{ plugin: 'demo', tree: { type: 'Text', props: { text: 'band body' } } }]
    })
    render(<ModsChrome />)
    const band = screen.getByRole('region', { name: 'Mod prompt band' })
    expect(band.classList.contains('mods-chrome-above')).toBe(true)
    expect(band.classList.contains('pawn-card')).toBe(true)
    expect(screen.getByText('band body')).toBeInTheDocument()
  })

  it('renders panes inside the .mods-chrome-dock container', () => {
    useModsUiStore.setState({
      panes: [
        {
          id: 'pane-1',
          title: 'Demo panel',
          plugin: 'demo',
          placement: 'docked',
          tree: { type: 'Text', props: { text: 'pane body' } }
        }
      ]
    })
    const { container } = render(<ModsChrome />)
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
})
