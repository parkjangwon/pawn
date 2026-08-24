// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CommandPalette from '../CommandPalette'
import { useAppStore } from '../../stores/app'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: any) => opts?.defaultValue || key }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

describe('CommandPalette — Keyboard navigation and actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      projects: [
        {
          id: 'p1',
          name: 'Pawn',
          paths: ['/path/to/pawn'],
          sessions: [
            { id: 's1', path: '/path/to/pawn', title: 'Session One', createdAt: 100, messages: [] },
            { id: 's2', path: '/path/to/pawn', title: 'Session Two', createdAt: 200, messages: [] }
          ]
        }
      ],
      activeProjectId: 'p1',
      activeSessionId: 's1',
      initialized: true
    })
  })

  it('renders sessions and actions with default selection at index 0', () => {
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()
    render(<CommandPalette onClose={onClose} onOpenSettings={onOpenSettings} />)

    const items = screen.getAllByRole('option')
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toHaveClass('selected')
  })

  it('navigates with ArrowDown and ArrowUp', () => {
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()
    render(<CommandPalette onClose={onClose} onOpenSettings={onOpenSettings} />)

    const items = screen.getAllByRole('option')
    expect(items[0]).toHaveClass('selected')

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(items[1]).toHaveClass('selected')

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(items[0]).toHaveClass('selected')
  })

  it('executes selected item on Enter', () => {
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()
    const onMainViewChange = vi.fn()

    render(
      <CommandPalette
        onClose={onClose}
        onOpenSettings={onOpenSettings}
        onMainViewChange={onMainViewChange}
      />
    )

    // First item is Session Two (sorted by createdAt desc: s2 = 200, s1 = 100)
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(useAppStore.getState().activeSessionId).toBe('s2')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes modal on Escape key', () => {
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()

    render(<CommandPalette onClose={onClose} onOpenSettings={onOpenSettings} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('triggers session immediately on Cmd+1 or Alt+1', () => {
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()
    render(<CommandPalette onClose={onClose} onOpenSettings={onOpenSettings} />)

    fireEvent.keyDown(window, { key: '2', metaKey: true })

    expect(useAppStore.getState().activeSessionId).toBe('s1')
    expect(onClose).toHaveBeenCalled()
  })

  it('updates selection on mouse move without conflict', () => {
    const onClose = vi.fn()
    const onOpenSettings = vi.fn()
    render(<CommandPalette onClose={onClose} onOpenSettings={onOpenSettings} />)

    const items = screen.getAllByRole('option')
    fireEvent.mouseMove(items[1])
    expect(items[1]).toHaveClass('selected')
  })
})
