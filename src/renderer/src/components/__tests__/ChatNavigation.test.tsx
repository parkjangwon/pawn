// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ChatFindBar, { countEarlierMatches } from '../ChatFindBar'
import SelectionActions, { readChatSelection } from '../SelectionActions'
import TurnNavigator from '../TurnNavigator'
import type { Message } from '../../stores/app'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key
  })
}))

const m = (id: string, role: Message['role'], content: string): Message => ({ id, role, content, createdAt: 1 })

function mountChat(html: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'chat-messages'
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('ChatFindBar', () => {
  const html = `
    <div class="message user"><div class="message-content">where is the router?</div></div>
    <div class="message assistant"><div class="message-content"><p>The router lives in agent/router.ts</p></div></div>
  `

  function renderBar(props: Partial<Parameters<typeof ChatFindBar>[0]> = {}) {
    const scrollEl = mountChat(html)
    const onClose = vi.fn()
    const utils = render(
      <ChatFindBar
        scrollEl={scrollEl}
        focusNonce={1}
        messages={[]}
        startIndex={0}
        onLoadEarlier={() => {}}
        onClose={onClose}
        {...props}
      />
    )
    return { ...utils, onClose, scrollEl }
  }

  it('focuses the input and counts matches across messages', () => {
    vi.useFakeTimers()
    renderBar()
    const input = screen.getByRole('textbox', { name: 'Find in conversation' })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'router' } })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // 1 match in the prompt + 2 in the reply. jsdom has no layout, so it
    // starts at the latest match.
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('steps through matches with Enter / Shift+Enter and wraps', () => {
    vi.useFakeTimers()
    renderBar({ initialQuery: 'router' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    const input = screen.getByRole('textbox', { name: 'Find in conversation' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('1/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByText('2/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('shows "no results" and disables navigation when nothing matches', () => {
    vi.useFakeTimers()
    renderBar({ initialQuery: 'zzz' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next match (Enter)' })).toBeDisabled()
  })

  it('closes on Escape', () => {
    const { onClose } = renderBar()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers to load earlier messages that also match', () => {
    vi.useFakeTimers()
    const onLoadEarlier = vi.fn()
    renderBar({
      initialQuery: 'router',
      messages: [m('old', 'user', 'old router question'), m('t', 'system', 'router tool'), m('new', 'user', 'x')],
      startIndex: 2,
      onLoadEarlier
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load them' }))
    expect(onLoadEarlier).toHaveBeenCalledTimes(1)
  })
})

describe('countEarlierMatches', () => {
  it('counts only unmounted user/assistant messages', () => {
    const msgs = [m('a', 'user', 'Needle'), m('b', 'system', 'needle'), m('c', 'assistant', 'nope'), m('d', 'user', 'needle')]
    expect(countEarlierMatches(msgs, 3, 'needle')).toBe(1)
    expect(countEarlierMatches(msgs, 0, 'needle')).toBe(0)
    expect(countEarlierMatches(msgs, 3, ' ')).toBe(0)
  })
})

describe('SelectionActions', () => {
  function selectText(node: Node, start: number, end: number): void {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    // jsdom has no layout; give the range a visible rect.
    range.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 80, height: 16, right: 180, bottom: 216, x: 100, y: 200, toJSON() {} }) as DOMRect
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  it('reads a selection only when it stays inside one message body', () => {
    const root = mountChat(`
      <div class="message assistant"><div class="message-role">Assistant</div><div class="message-content"><p id="a">alpha beta</p></div></div>
      <div class="message user"><div class="message-content"><p id="b">gamma</p></div></div>
    `)
    const a = root.querySelector('#a')!.firstChild!
    selectText(a, 0, 5)
    expect(readChatSelection(root)?.text).toBe('alpha')

    const range = document.createRange()
    range.setStart(a, 0)
    range.setEnd(root.querySelector('#b')!.firstChild!, 2)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(readChatSelection(root)).toBeNull()

    selectText(root.querySelector('.message-role')!.firstChild!, 0, 4)
    expect(readChatSelection(root)).toBeNull()
  })

  it('quotes the selected text into the composer', async () => {
    const root = mountChat('<div class="message assistant"><div class="message-content"><p id="a">quote me please</p></div></div>')
    const onQuote = vi.fn()
    render(<SelectionActions scrollEl={root} onQuote={onQuote} onFind={() => {}} />)
    selectText(root.querySelector('#a')!.firstChild!, 0, 8)
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Quote' }))
    expect(onQuote).toHaveBeenCalledWith('quote me')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})

describe('TurnNavigator', () => {
  const messages = [
    m('u1', 'user', 'first prompt'),
    m('a1', 'assistant', 'first reply'),
    m('u2', 'user', 'second prompt'),
    m('a2', 'assistant', 'second reply')
  ]

  it('renders nothing for a single-turn conversation', () => {
    const { container } = render(
      <TurnNavigator messages={messages.slice(0, 2)} scrollEl={mountChat('')} onJump={() => {}} />
    )
    expect(container.querySelector('.turn-nav')).toBeNull()
  })

  it('renders one bar per prompt, previews on hover, and jumps on click', () => {
    const onJump = vi.fn()
    render(<TurnNavigator messages={messages} scrollEl={mountChat('')} onJump={onJump} />)
    const bars = screen.getAllByRole('button', { name: /Jump to prompt/ })
    expect(bars).toHaveLength(2)
    fireEvent.pointerEnter(bars[0])
    expect(screen.getByRole('tooltip')).toHaveTextContent('first prompt')
    expect(screen.getByRole('tooltip')).toHaveTextContent('first reply')
    fireEvent.click(bars[1])
    expect(onJump).toHaveBeenCalledWith('u2')
  })

  it('marks the latest prompt as running while the agent works', () => {
    render(<TurnNavigator messages={messages.slice(0, 3)} scrollEl={mountChat('')} busy onJump={() => {}} />)
    const bars = screen.getAllByRole('button', { name: /Jump to prompt/ })
    expect(bars[1]).toHaveClass('running')
    fireEvent.pointerEnter(bars[1])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Working on it…')
  })
})
