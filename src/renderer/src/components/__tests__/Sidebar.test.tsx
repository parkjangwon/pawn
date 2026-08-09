// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import Sidebar from '../Sidebar'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // stores/chat.ts pulls in stores/usage.ts -> i18n/index.ts, which calls
  // i18n.use(initReactI18next) at import time — needs a valid plugin shape.
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

const dbMock = {
  addProject: vi.fn().mockResolvedValue({ ok: true }),
  removeProject: vi.fn().mockResolvedValue({ ok: true }),
  addSession: vi.fn().mockResolvedValue({ ok: true }),
  removeSession: vi.fn().mockResolvedValue({ ok: true }),
  updateSessionTitle: vi.fn().mockResolvedValue({ ok: true })
}

function noop(): void {}

beforeEach(() => {
  ;(window as any).api = { db: dbMock }
  Object.values(dbMock).forEach((fn) => fn.mockClear())
  useAppStore.setState({
    projects: [],
    activeProjectId: null,
    activeSessionId: null,
    initialized: true,
    loadedSessions: new Set()
  })
  useChatStore.setState({ isStreaming: false, streamingSessionId: null, streamingSessionIds: [] })
  try { localStorage.removeItem('pawn-pinned-sessions') } catch {}
  try { localStorage.removeItem('pawn-sidebar-width') } catch {}
  document.documentElement.style.removeProperty('--sidebar-width')
  document.body.classList.remove('resizing-sidebar')
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

function renderSidebar(props: { onSidebarWidthChange?: (width: number) => void } = {}): ReturnType<typeof render> {
  return render(
    <Sidebar
      onOpenSettings={noop}
      onToggle={noop}
      open
      mainView="chat"
      onMainViewChange={noop}
      onSidebarWidthChange={props.onSidebarWidthChange || noop}
    />
  )
}

/** The project row also has a (project-level) delete button with the same
 *  title, so scope the query to the specific session row by its title text. */
function deleteButtonForSession(sessionTitle: string): HTMLElement {
  const row = screen.getByText(sessionTitle).closest('.sidebar-item') as HTMLElement
  return within(row).getByTitle('common.delete')
}

describe('Sidebar — session deletion', () => {
  it('deletes a session from the Recent list after confirming', async () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'My Session')
    const sessionId = useAppStore.getState().activeSessionId!

    renderSidebar()
    fireEvent.click(screen.getByText('sidebar.recent'))
    expect(screen.getByText('My Session')).toBeInTheDocument()

    fireEvent.click(deleteButtonForSession('My Session'))
    fireEvent.click(await screen.findByText('confirmDialog.confirm'))

    expect(useAppStore.getState().projects[0].sessions).toHaveLength(0)
    expect(dbMock.removeSession).toHaveBeenCalledWith(sessionId)
  })

  it('deletes a pinned session and drops it from the pinned set', async () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'Pinned Session')
    const sessionId = useAppStore.getState().activeSessionId!
    localStorage.setItem('pawn-pinned-sessions', JSON.stringify([sessionId]))

    renderSidebar()
    expect(screen.getByText('sidebar.pinned')).toBeInTheDocument()
    fireEvent.click(deleteButtonForSession('Pinned Session'))
    fireEvent.click(await screen.findByText('confirmDialog.confirm'))

    expect(useAppStore.getState().projects[0].sessions).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('pawn-pinned-sessions') || '[]')).not.toContain(sessionId)
  })

  it('stops an in-flight stream before deleting the session it belongs to', async () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'Streaming Session')
    const sessionId = useAppStore.getState().activeSessionId!
    const stopStreaming = vi.fn()
    useChatStore.setState({ isStreaming: true, streamingSessionId: sessionId, streamingSessionIds: [sessionId], stopStreaming })

    renderSidebar()
    fireEvent.click(screen.getByText('sidebar.recent'))
    fireEvent.click(deleteButtonForSession('Streaming Session'))
    fireEvent.click(await screen.findByText('confirmDialog.confirm'))

    expect(stopStreaming).toHaveBeenCalledTimes(1)
  })

  it('leaves an unrelated in-flight stream alone', async () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'Target')
    const targetId = useAppStore.getState().activeSessionId!
    const stopStreaming = vi.fn()
    useChatStore.setState({ isStreaming: true, streamingSessionId: 'some-other-session', streamingSessionIds: ['some-other-session'], stopStreaming })

    renderSidebar()
    fireEvent.click(screen.getByText('sidebar.recent'))
    fireEvent.click(deleteButtonForSession('Target'))
    fireEvent.click(await screen.findByText('confirmDialog.confirm'))

    expect(stopStreaming).not.toHaveBeenCalled()
    expect(useAppStore.getState().projects[0].sessions.find((s) => s.id === targetId)).toBeUndefined()
  })
})

describe('Sidebar — width resizing', () => {
  it('drags the resizer to widen the sidebar and reports the new width', () => {
    const onWidthChange = vi.fn()
    renderSidebar({ onSidebarWidthChange: onWidthChange })
    const resizer = document.querySelector('.sidebar-resizer') as HTMLElement
    expect(resizer).not.toBeNull()

    fireEvent.pointerDown(resizer, { clientX: 300 })
    fireEvent.pointerMove(document, { clientX: 360 })
    fireEvent.pointerUp(document)

    expect(onWidthChange).toHaveBeenCalledWith(304)
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('304px')
    expect(document.body.classList.contains('resizing-sidebar')).toBe(false)
    expect(document.body.style.cursor).toBe('')
  })

  it('clamps the sidebar width to its minimum bound', () => {
    const onWidthChange = vi.fn()
    renderSidebar({ onSidebarWidthChange: onWidthChange })
    const resizer = document.querySelector('.sidebar-resizer') as HTMLElement

    fireEvent.pointerDown(resizer, { clientX: 300 })
    fireEvent.pointerMove(document, { clientX: -500 })
    fireEvent.pointerUp(document)

    expect(onWidthChange).toHaveBeenCalledWith(200)
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('200px')
  })
})
