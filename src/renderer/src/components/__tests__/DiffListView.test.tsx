// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import DiffListView from '../DiffListView'
import { useAppStore } from '../../stores/app'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function seedStore(messages: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>): void {
  useAppStore.setState({
    projects: [
      {
        id: 'p1',
        name: 'Test Project',
        paths: ['/tmp/project'],
        sessions: [
          { id: 's1', title: 'Session', path: '/tmp/project', createdAt: 1, messages: messages.map((m) => ({ ...m, createdAt: 1 })) }
        ]
      }
    ],
    activeProjectId: 'p1',
    activeSessionId: 's1'
  })
}

const diffMessage = (id: string, filename: string, oldText: string, newText: string): { id: string; role: 'system'; content: string } => ({
  id,
  role: 'system',
  content: `[Tool: edit_file] OK\nedited\n__DIFF__:${JSON.stringify({ filename, oldText, newText })}`
})

describe('DiffListView', () => {
  it('shows the empty state when no diff messages exist', () => {
    seedStore([{ id: 'm0', role: 'user', content: 'hi' }])
    render(<DiffListView />)
    expect(screen.getByText('rightPanel.diff.empty')).toBeInTheDocument()
  })

  it('lists diff items from system messages only', () => {
    seedStore([
      { id: 'm0', role: 'user', content: 'hi' },
      { id: 'm1', role: 'system', content: '[Tool: read_file] OK\nplain output, no diff' },
      diffMessage('m2', 'src/a.ts', 'old', 'new')
    ])
    render(<DiffListView />)
    expect(screen.getByText('Recent Changes (1)')).toBeInTheDocument()
    expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('3 → 3 chars')).toBeInTheDocument()
  })

  it('expands and collapses a diff on click', () => {
    seedStore([diffMessage('m1', 'a.ts', 'old', 'new')])
    const { container } = render(<DiffListView />)

    expect(screen.queryByText('+1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('a.ts'))
    expect(screen.getAllByText('a.ts').length).toBeGreaterThan(1)
    expect(screen.getByText('+1')).toBeInTheDocument()

    fireEvent.click(container.querySelector('.rp-diff-item') as HTMLElement)
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })

  it('keeps the expanded state tied to the message id, not the list position', () => {
    seedStore([
      diffMessage('m1', 'first.ts', 'a', 'b'),
      diffMessage('m2', 'second.ts', 'a', 'b')
    ])
    render(<DiffListView />)
    fireEvent.click(screen.getByText('first.ts'))
    expect(screen.getByText('+1')).toBeInTheDocument()

    // A new diff arriving at the end shifts the reversed order.
    act(() => {
      seedStore([
        diffMessage('m1', 'first.ts', 'a', 'b'),
        diffMessage('m2', 'second.ts', 'a', 'b'),
        diffMessage('m3', 'third.ts', 'a', 'b')
      ])
    })
    expect(screen.getByText('Recent Changes (3)')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getAllByText('first.ts').length).toBeGreaterThan(1)
  })
})
