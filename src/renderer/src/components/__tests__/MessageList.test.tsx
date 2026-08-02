// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MessageList from '../MessageList'
import { useStreamingStore } from '../../stores/streaming'
import type { Message } from '../../stores/app'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${opts.count}` : key)
  })
}))

const endRef = { current: null } as React.RefObject<HTMLDivElement | null>

function msg(id: string, role: 'user' | 'assistant' = 'assistant', content = ''): Message {
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
  useStreamingStore.setState({ content: {} })
})

describe('MessageList', () => {
  it('renders user and assistant labels from i18n', () => {
    renderList({ messages: [msg('u1', 'user', 'hello'), msg('a1', 'assistant', 'world')] })
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
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

  it('shows live streaming content and falls back to stored content after the flush', () => {
    useStreamingStore.getState().setContent('a1', 'live text')
    const { rerender } = renderList({ messages: [msg('a1', 'assistant', 'stored text')] })
    expect(screen.getByText('live text')).toBeInTheDocument()

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
})
