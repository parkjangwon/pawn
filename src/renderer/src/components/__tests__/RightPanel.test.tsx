// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import RightPanel from '../RightPanel'
import { useAppStore } from '../../stores/app'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../TerminalView', () => ({ default: () => <div>TERMINAL_VIEW</div> }))
vi.mock('../FilesView', () => ({ default: () => <div>FILES_VIEW</div> }))
vi.mock('../GitView', () => ({ default: () => <div>GIT_VIEW</div> }))
vi.mock('../BrowserView', () => ({ default: () => <div>BROWSER_VIEW</div> }))
vi.mock('../DiffListView', () => ({ default: () => <div>DIFF_LIST_VIEW</div> }))

beforeEach(() => {
  ;(window as any).api = { onAppShortcut: vi.fn(() => () => {}) }
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'P', paths: ['/tmp/p'], sessions: [] }],
    activeProjectId: 'p1',
    activeSessionId: null
  })
})

describe('RightPanel', () => {
  it('starts closed with the tool picker mounted', () => {
    const { container } = render(<RightPanel />)
    expect(screen.getByText('rightPanel.openTool')).toBeInTheDocument()
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('display: none')
  })

  it('opens a tool tab on click', () => {
    render(<RightPanel />)
    fireEvent.click(screen.getByText('rightPanel.tools.terminal'))
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()
  })

  it('toggles with the Option+Cmd+B shortcut', () => {
    // Renderer-side key handling only applies in dev:web; Electron forwards
    // through the main process instead.
    ;(window as any).api.platform = 'browser'
    const { container } = render(<RightPanel />)
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('display: none')

    fireEvent.keyDown(window, { key: 'b', altKey: true, metaKey: true })
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('width: 0px')

    fireEvent.keyDown(window, { key: 'b', altKey: true, metaKey: true })
    expect(container.querySelector('aside')?.className).toContain('closing')
  })

  it('does not double-toggle in Electron, where the main process owns the shortcut', () => {
    ;(window as any).api.platform = 'darwin'
    const { container } = render(<RightPanel />)
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('display: none')

    fireEvent.keyDown(window, { key: 'b', altKey: true, metaKey: true })
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('display: none')
  })

  it('exposes the toggle bridge on window', () => {
    const { container } = render(<RightPanel />)
    act(() => {
      ;(window as any).__toggleRightPanel()
    })
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('width: 0px')
  })

  it('toggles when the main process forwards the browser-focus shortcut', () => {
    const { container } = render(<RightPanel />)
    const callback = (window as any).api.onAppShortcut.mock.calls[0][0]
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('display: none')

    act(() => {
      callback('toggle-right-panel')
    })
    expect(container.querySelector('aside')?.getAttribute('style')).toContain('width: 0px')
  })

  it('closing the last tab starts the hide animation', () => {
    const { container } = render(<RightPanel />)
    fireEvent.click(screen.getByText('rightPanel.tools.terminal'))
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()

    fireEvent.click(container.querySelector('.rp-tab-close-btn') as HTMLElement)
    expect(screen.queryByText('TERMINAL_VIEW')).not.toBeInTheDocument()
    expect(container.querySelector('aside')?.className).toContain('closing')
  })

  it('keeps a hidden terminal tab mounted until the tab is closed', () => {
    ;(window as any).api.platform = 'browser'
    const { container } = render(<RightPanel />)
    fireEvent.click(screen.getByText('rightPanel.tools.terminal'))
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'b', altKey: true, metaKey: true })
    expect(container.querySelector('aside')?.className).toContain('closing')
    // display:none keeps the subtree mounted, so the PTY session survives.
    expect(screen.getByText('TERMINAL_VIEW')).toBeInTheDocument()
  })
})
