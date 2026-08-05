// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import BottomTerminal from '../BottomTerminal'
import { useAppStore } from '../../stores/app'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('../TerminalView', () => ({ default: () => <div>TERMINAL_VIEW</div> }))

beforeEach(() => {
  ;(window as any).api = { onAppShortcut: vi.fn(() => () => {}) }
  delete (window as any).__toggleTerminal
  delete (window as any).__openTerminal
  delete (window as any).__closeTerminal
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'P', paths: ['/tmp/p'], sessions: [] }],
    activeProjectId: 'p1',
    activeSessionId: null
  })
})

describe('BottomTerminal', () => {
  it('starts closed without mounting the terminal', () => {
    const { container } = render(<BottomTerminal />)
    expect(screen.queryByText('TERMINAL_VIEW')).not.toBeInTheDocument()
    expect(container.querySelector('.bottom-terminal')?.getAttribute('style')).toContain('display: none')
  })

  it('opens via the window bridge and mounts the terminal', () => {
    const { container } = render(<BottomTerminal />)
    act(() => {
      ;(window as any).__openTerminal()
    })
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()
    expect(container.querySelector('.bottom-terminal')?.className).toContain('open')
  })

  it('toggles with Ctrl+` in browser mode', () => {
    ;(window as any).api.platform = 'browser'
    const { container } = render(<BottomTerminal />)
    expect(container.querySelector('.bottom-terminal')?.getAttribute('style')).toContain('display: none')

    fireEvent.keyDown(window, { key: '`', ctrlKey: true, code: 'Backquote' })
    expect(container.querySelector('.bottom-terminal')?.className).toContain('open')
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '`', ctrlKey: true, code: 'Backquote' })
    expect(container.querySelector('.bottom-terminal')?.className).toContain('closing')
  })

  it('keeps the terminal mounted after hide so the PTY can survive', () => {
    const { container } = render(<BottomTerminal />)
    act(() => {
      ;(window as any).__openTerminal()
    })
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()

    act(() => {
      ;(window as any).__closeTerminal()
    })
    expect(container.querySelector('.bottom-terminal')?.className).toContain('closing')
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()
  })

  it('toggles when the main process forwards the shortcut', () => {
    const { container } = render(<BottomTerminal />)
    const callback = (window as any).api.onAppShortcut.mock.calls[0][0]
    act(() => {
      callback('toggle-terminal')
    })
    expect(container.querySelector('.bottom-terminal')?.className).toContain('open')
  })
})
