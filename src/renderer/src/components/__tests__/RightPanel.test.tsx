// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import RightPanel from '../RightPanel'
import { useAppStore } from '../../stores/app'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

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
    fireEvent.click(screen.getByText('rightPanel.tools.files'))
    expect(screen.getByText('FILES_VIEW')).toBeInTheDocument()
  })

  it('routes terminal open/close to the bottom terminal bridges', () => {
    const openTerminal = vi.fn()
    const closeTerminal = vi.fn()
    ;(window as any).__openTerminal = openTerminal
    ;(window as any).__closeTerminal = closeTerminal
    render(<RightPanel />)
    act(() => {
      ;(window as any).__openRightPanelTab('terminal')
    })
    expect(openTerminal).toHaveBeenCalled()
    expect(screen.queryByText('FILES_VIEW')).not.toBeInTheDocument()

    act(() => {
      ;(window as any).__closeRightPanelTab('terminal')
    })
    expect(closeTerminal).toHaveBeenCalled()
  })

  it('does not collapse an already-open panel when a tool is chosen', async () => {
    // Reproduces the real flow: open the panel first, then pick a tool. The
    // slide-in (`opening`) must only run when the panel is actually closed —
    // otherwise it collapses the open panel and never recovers.
    const { container } = render(<RightPanel />)
    act(() => {
      ;(window as any).__toggleRightPanel()
    })
    // Let the slide-in animation settle (the layout effect resets `opening`
    // inside requestAnimationFrame).
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    // Settled: width is panelWidth, not the opening placeholder of 0.
    expect(container.querySelector('aside')?.getAttribute('style')).not.toContain('width: 0px')

    // Choose a tool from the picker while the panel is already open.
    fireEvent.click(screen.getByText('rightPanel.tools.files'))
    expect(screen.getByText('FILES_VIEW')).toBeInTheDocument()
    // Regression: the panel must not collapse back to width 0.
    expect(container.querySelector('aside')?.getAttribute('style')).not.toContain('width: 0px')
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
    fireEvent.click(screen.getByText('rightPanel.tools.files'))
    expect(screen.getByText('FILES_VIEW')).toBeInTheDocument()

    fireEvent.click(container.querySelector('.rp-tab-close-btn') as HTMLElement)
    expect(screen.queryByText('FILES_VIEW')).not.toBeInTheDocument()
    expect(container.querySelector('aside')?.className).toContain('closing')
  })

  it('keeps a hidden tool tab mounted until the tab is closed', () => {
    ;(window as any).api.platform = 'browser'
    const { container } = render(<RightPanel />)
    fireEvent.click(screen.getByText('rightPanel.tools.files'))
    expect(screen.getByText('FILES_VIEW')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'b', altKey: true, metaKey: true })
    expect(container.querySelector('aside')?.className).toContain('closing')
    // display:none keeps the subtree mounted so panel state survives hide.
    expect(screen.getByText('FILES_VIEW')).toBeInTheDocument()
  })

  it('marks the browser tab on subagent open and hands ownership back to the main agent', () => {
    const destroy = vi.fn()
    const setVisible = vi.fn()
    ;(window as any).api.browser = { destroy, setVisible }
    ;(window as any).__subagentOpenedBrowserPanel = false
    const { container } = render(<RightPanel />)

    // Subagent-driven open → marker set, tab shown.
    act(() => { ;(window as any).__openRightPanelTab('browser', { subagent: true }) })
    expect(screen.getByText('BROWSER_VIEW')).toBeInTheDocument()
    expect((window as any).__subagentOpenedBrowserPanel).toBe(true)

    // A main-agent (or user) call on the already-open, active tab takes
    // ownership → marker cleared even on the early-return path.
    act(() => { ;(window as any).__openRightPanelTab('browser', { subagent: false }) })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)
    expect(container.querySelector('aside')?.className).not.toContain('closing')
  })

  it('closes the panel via __closeRightPanel without destroying the browser', () => {
    const destroy = vi.fn()
    const setVisible = vi.fn()
    ;(window as any).api.browser = { destroy, setVisible }
    const { container } = render(<RightPanel />)
    act(() => { ;(window as any).__openRightPanelTab('browser', { subagent: true }) })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(true)

    // All subagent work done → __closeRightPanel hides the panel + clears the
    // marker without destroying the browser.
    act(() => { ;(window as any).__closeRightPanel() })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)
    expect(container.querySelector('aside')?.className).toContain('closing')
    expect(destroy).not.toHaveBeenCalled()
  })

  it('hides the embedded browser while a full-screen overlay is open and restores it after', () => {
    const setVisible = vi.fn()
    ;(window as any).api.browser = { setVisible }
    render(<RightPanel />)
    act(() => { ;(window as any).__openRightPanelTab('browser') })
    expect(screen.getByText('BROWSER_VIEW')).toBeInTheDocument()

    setVisible.mockClear()
    // Settings overlay opens → native view must hide (it cannot be covered by
    // renderer z-index), while the panel keeps its tab.
    act(() => { ;(window as any).__setRightPanelBrowserVisible(false) })
    expect(setVisible).toHaveBeenCalledWith(false)
    expect(screen.getByText('BROWSER_VIEW')).toBeInTheDocument()

    // Settings closes → the still-open browser tab is restored.
    act(() => { ;(window as any).__restoreRightPanelBrowser() })
    expect(setVisible).toHaveBeenCalledWith(true)
  })

  it('does not restore the browser view when the panel is hidden or browser is not active', () => {
    const setVisible = vi.fn()
    ;(window as any).api.browser = { setVisible }
    render(<RightPanel />)
    act(() => { ;(window as any).__openRightPanelTab('files') })
    setVisible.mockClear()

    act(() => { ;(window as any).__restoreRightPanelBrowser() })
    expect(setVisible).not.toHaveBeenCalled()
  })

  it('clears the subagent marker on any user tab interaction', () => {
    const destroy = vi.fn()
    const setVisible = vi.fn()
    ;(window as any).api.browser = { destroy, setVisible }
    const { container } = render(<RightPanel />)
    act(() => { ;(window as any).__openRightPanelTab('browser', { subagent: true }) })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(true)

    // User opens a *non-browser* tool (Files) → ownership → marker cleared, so
    // the panel (Files and all) is never auto-closed under the user.
    act(() => { ;(window as any).__openRightPanelTab('files') })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)

    // Subagent re-opens → marker back; user switches to the browser tab →
    // cleared; a subagent re-open of the active tab cannot re-claim it.
    act(() => { ;(window as any).__openRightPanelTab('browser', { subagent: true }) })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(true)
    const tabBtn = [...container.querySelectorAll('.rp-tab')].find(
      (b) => b.querySelector('.rp-tab-label')?.textContent === 'rightPanel.tools.browser'
    ) as HTMLElement
    act(() => { fireEvent.click(tabBtn) })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)
    act(() => { ;(window as any).__openRightPanelTab('browser', { subagent: true }) })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)

    // Closing the browser tab keeps it cleared.
    act(() => { ;(window as any).__closeRightPanelTab('browser') })
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)
  })
})
