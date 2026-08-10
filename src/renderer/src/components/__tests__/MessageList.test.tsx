// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MessageList from '../MessageList'
import { useStreamingStore, __flushStreamingForTests } from '../../stores/streaming'
import type { Message } from '../../stores/app'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${opts.count}` : key)
  })
}))

const endRef = { current: null } as React.RefObject<HTMLDivElement | null>

function msg(id: string, role: 'user' | 'assistant' | 'system' = 'assistant', content = ''): Message {
  return { id, role, content, createdAt: 1 }
}

function renderList(props: Partial<Parameters<typeof MessageList>[0]> = {}): ReturnType<typeof render> {
  return render(
    <MessageList
      messages={[msg('m1')]}
      isStreaming={false}
      endRef={endRef}
      startIndex={0}
      nearTop={false}
      onShowEarlier={() => {}}
      onScroll={() => {}}
      {...props}
    />
  )
}

beforeEach(() => {
  useStreamingStore.setState({ content: {}, thinking: {} })
})

describe('MessageList', () => {
  it('renders user and assistant labels from i18n', () => {
    renderList({ messages: [msg('u1', 'user', 'hello'), msg('a1', 'assistant', 'world')] })
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('renders a copy button on every user and assistant message', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true
    })
    renderList({ messages: [msg('u1', 'user', 'hello'), msg('a1', 'assistant', 'world')] })
    const buttons = screen.getAllByRole('button', { name: 'chat.copy' })
    expect(buttons).toHaveLength(2)
    // User copies the raw text; assistant copies the markdown source.
    fireEvent.click(buttons[0])
    expect(await screen.findByText('chat.copied')).toBeInTheDocument()
  })

  it('slices from startIndex and offers to reveal earlier messages at the top', () => {
    const messages = Array.from({ length: 5 }, (_, i) => msg(`m${i}`, 'assistant', `text${i}`))
    renderList({ messages, startIndex: 3, nearTop: true })
    expect(screen.queryByText('text0')).not.toBeInTheDocument()
    expect(screen.getByText('text3')).toBeInTheDocument()
    expect(screen.getByText('chat.showEarlier:3')).toBeInTheDocument()
  })

  it('hides the load-earlier button when the user is not near the top', () => {
    renderList({ messages: [msg('a', 'assistant', 'x')], startIndex: 1, nearTop: false })
    expect(screen.queryByText('chat.showEarlier:1')).not.toBeInTheDocument()
  })

  it('fires onShowEarlier from the button', () => {
    const onShowEarlier = vi.fn()
    renderList({ messages: [msg('a', 'assistant', 'x')], startIndex: 1, nearTop: true, onShowEarlier })
    fireEvent.click(screen.getByText('chat.showEarlier:1'))
    expect(onShowEarlier).toHaveBeenCalledTimes(1)
  })

  it('renders tool call logs as a collapsed ToolMessage row, not a full bubble', () => {
    renderList({
      messages: [
        msg('u1', 'user', 'read the file'),
        msg('t1', 'system', '[Tool: read_file] OK\nline one\nline two'),
        msg('a1', 'assistant', 'done')
      ]
    })
    // Collapsed by default: the header (name + status) shows, the body doesn't.
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.queryByText('line one')).not.toBeInTheDocument()
    // No message-role label or copy button for the tool row — only the two
    // real chat bubbles get one.
    expect(screen.getAllByRole('button', { name: 'chat.copy' })).toHaveLength(2)
  })

  it('shows live streaming content and falls back to stored content after the flush', () => {
    useStreamingStore.getState().setContent('a1', 'live text')
    __flushStreamingForTests()
    const { rerender } = renderList({ messages: [msg('a1', 'assistant', 'stored text')] })
    // Live stream renders complete lines as markdown; partial tail as raw text.
    expect(screen.getByText(/live text/)).toBeInTheDocument()

    useStreamingStore.getState().clear('a1')
    rerender(
      <MessageList
        messages={[msg('a1', 'assistant', 'stored text')]}
        isStreaming={false}
        endRef={endRef}
        startIndex={0}
        nearTop={false}
        onShowEarlier={() => {}}
      />
    )
    expect(screen.getByText('stored text')).toBeInTheDocument()
  })

  it('renders completed lines as markdown and keeps the partial line raw while streaming', () => {
    useStreamingStore.getState().setContent('m1', '## Done\nstill typing')
    __flushStreamingForTests()
    renderList({ messages: [msg('m1', 'assistant', 'stored')], isStreaming: true })
    // The completed line became a real heading…
    expect(screen.getByRole('heading', { level: 2, name: 'Done' })).toBeInTheDocument()
    // …while the in-progress tail line stays as raw text with the cursor.
    expect(screen.getByText(/still typing/)).toBeInTheDocument()
  })

  it('shows one-line thinking indicator while live, then expands the full text after flush', () => {
    useStreamingStore.getState().setThinking('m1', 'deep reasoning text')
    __flushStreamingForTests()
    const { rerender } = renderList({ messages: [msg('m1', 'assistant', 'stored')], isStreaming: true })
    // Live: single compact line only — the reasoning body stays hidden.
    expect(screen.getByText('chat.thinkingLive')).toBeInTheDocument()
    expect(screen.queryByText(/deep reasoning/)).not.toBeInTheDocument()

    // After flush: one-line toggle, full text on demand.
    useStreamingStore.getState().clear('m1')
    rerender(
      <MessageList
        messages={[{ ...msg('m1', 'assistant', 'stored'), thinking: 'deep reasoning text' }]}
        isStreaming={false}
        endRef={endRef}
        startIndex={0}
        nearTop={false}
        onShowEarlier={() => {}}
      />
    )
    expect(screen.getByText('chat.thinking')).toBeInTheDocument()
    expect(screen.queryByText(/deep reasoning/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('chat.thinking'))
    expect(screen.getByText('deep reasoning text')).toBeInTheDocument()
  })
})
