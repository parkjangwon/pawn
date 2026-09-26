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

describe('CommandPalette — fuzzy search and recent actions', () => {
  beforeEach(() => {
    localStorage.removeItem('pawn-cp-recent')
    useAppStore.setState({
      projects: [
        {
          id: 'p1',
          name: 'Pawn',
          paths: ['/path/to/pawn'],
          sessions: [{ id: 's1', path: '/path/to/pawn', title: 'Session One', createdAt: 100, messages: [] }]
        }
      ],
      activeProjectId: 'p1',
      activeSessionId: 's1',
      initialized: true
    })
  })

  it('matches subsequences and ranks the best match first', () => {
    render(<CommandPalette onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('commandPalette.placeholder'), {
      target: { value: 'tglsdb' }
    })
    const items = screen.getAllByRole('option')
    expect(items[0]).toHaveTextContent('commandPalette.commands.toggleSidebar')
  })

  it('highlights matched characters in labels', () => {
    render(<CommandPalette onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('commandPalette.placeholder'), { target: { value: 'Session' } })
    const marks = document.querySelectorAll('mark.cp-match')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].textContent).toBe('Session')
  })

  it('remembers executed actions and lists them under Recently used', () => {
    const onOpenSettings = vi.fn()
    const { unmount } = render(<CommandPalette onClose={vi.fn()} onOpenSettings={onOpenSettings} />)
    fireEvent.change(screen.getByPlaceholderText('commandPalette.placeholder'), { target: { value: 'settings' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenSettings).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('pawn-cp-recent') || '[]')).toEqual(['open-settings'])
    unmount()

    render(<CommandPalette onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'commandPalette.groups.recent' })).toHaveTextContent(
      'commandPalette.commands.openSettings'
    )
    // Sessions keep the first slot so Enter still reopens the latest chat.
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Session One')
  })

  it('does not record session jumps as recent actions', () => {
    render(<CommandPalette onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(localStorage.getItem('pawn-cp-recent')).toBeNull()
  })

  it('offers find-in-conversation only when the active chat has messages', () => {
    const { unmount } = render(<CommandPalette onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.queryByText('commandPalette.commands.findInChat')).not.toBeInTheDocument()
    unmount()
    useAppStore.setState({
      projects: [
        {
          id: 'p1',
          name: 'Pawn',
          paths: [],
          sessions: [
            {
              id: 's1',
              path: '',
              title: 'Session One',
              createdAt: 100,
              messages: [{ id: 'm', role: 'user', content: 'hi', createdAt: 1 }]
            }
          ]
        }
      ]
    })
    render(<CommandPalette onClose={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText('commandPalette.commands.findInChat')).toBeInTheDocument()
  })
})
