import React, { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownRenderer from './MarkdownRenderer'
import ToolMessage from './ToolMessage'
import ToolBatch from './ToolBatch'
import SubagentActivity from './SubagentActivity'
import { useStreamingStore } from '../stores/streaming'
import { useChatStore } from '../stores/chat'
import { stripDisplayImages } from '../utils/attachments'
import type { Message } from '../stores/app'

class MessageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null }
  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
    return { hasError: true, error }
  }
  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="message message-render-error" style={{ opacity: 0.8, fontSize: '12px', padding: '8px 12px' }}>
          <span>⚠ Message content failed to render ({this.state.error?.message || 'render error'})</span>
        </div>
      )
    }
    return this.props.children
  }
}

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  endRef: React.RefObject<HTMLDivElement | null>
  startIndex: number
  nearTop: boolean
  onShowEarlier: () => void
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  /** Session switch key — remounts list for clean enter animation. */
  sessionKey?: string
  projectId?: string | null
  sessionId?: string | null
}

/**
 * Live streaming view: render markdown progressively, line by line.
 * Complete lines (up to the last newline) go through MarkdownRenderer so the
 * structure — headings, lists, code blocks — appears as it arrives. The
 * incomplete tail line stays as cheap raw text, which caps re-parse cost at
 * the line rate instead of one full AST pass per animation frame.
 */
const StreamingMarkdown = memo(function StreamingMarkdown({
  text
}: {
  text: string
}): React.JSX.Element {
  const nl = text.lastIndexOf('\n')
  const complete = nl >= 0 ? text.slice(0, nl + 1) : ''
  const tail = nl >= 0 ? text.slice(nl + 1) : text
  return (
    <div className="message-content streaming message-content-live">
      {complete ? <MarkdownRenderer content={complete} /> : null}
      <span className="streaming-tail">
        {tail}
        <span className="cursor-blink">▍</span>
      </span>
    </div>
  )
})

/**
 * Thinking/reasoning: a single compact line while live — keeps the bubble
 * small and progress feels instant (Reasonix-style). The full text stays
 * available on demand via the toggle after the turn completes.
 */
function ThinkingBlock({
  text,
  live
}: {
  text: string
  live?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!live) return
    setElapsed(0)
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [live])
  if (!text?.trim()) return null
  if (live) {
    return (
      <div className="message-thinking live one-line">
        <span className="message-thinking-spinner" aria-hidden="true" />
        <span className="message-thinking-label">{t('chat.thinkingLive')}</span>
        <span className="message-thinking-elapsed">{elapsed}s</span>
      </div>
    )
  }
  return (
    <div className="message-thinking">
      <button
        type="button"
        className="message-thinking-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>{t('chat.thinking')}</span>
      </button>
      {open && <pre className="message-thinking-body">{text}</pre>}
    </div>
  )
}

const MessageRow = memo(function MessageRow({
  msg,
  animateIn,
  isStreamingTail,
  projectId,
  sessionId,
  canAct
}: {
  msg: Message
  animateIn?: boolean
  isStreamingTail?: boolean
  projectId?: string | null
  sessionId?: string | null
  canAct?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const live = useStreamingStore((s) => s.content[msg.id])
  const liveThinking = useStreamingStore((s) => s.thinking[msg.id])
  const liveActivity = useStreamingStore((s) => s.activity[msg.id])
  const content = live ?? msg.content
  const thinking = liveThinking ?? msg.thinking
  const isLive = live !== undefined
  const copyText = msg.role === 'user' ? stripDisplayImages(msg.content) : msg.content
  const enterClass = animateIn ? ' message-enter' : ''
  const editAndResend = useChatStore((s) => s.editAndResend)
  const regenerate = useChatStore((s) => s.regenerate)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard optional */
    }
  }

  if (msg.role === 'system') {
    return (
      <div className={`message system${enterClass}`}>
        <ToolMessage content={content} />
      </div>
    )
  }

  return (
    <div
      className={`message ${msg.role}${enterClass}${isStreamingTail || isLive ? ' message-live' : ''}`}
    >
      <div className="message-role">
        {msg.role === 'user' ? t('chat.you') : t('chat.assistant')}
      </div>
      <div className="message-body">
        {msg.role === 'assistant' && thinking ? (
          <ThinkingBlock text={thinking} live={Boolean(liveThinking)} />
        ) : null}
        {msg.role === 'assistant' && liveActivity ? (
          <div className="message-activity live one-line">
            <span className="message-thinking-spinner" aria-hidden="true" />
            <span className="message-activity-text">{liveActivity}</span>
          </div>
        ) : null}
        {editing && msg.role === 'user' ? (
          <div className="message-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="message-edit-actions">
              <button type="button" className="message-action-btn" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="message-action-btn primary"
                disabled={!draft.trim() || !projectId || !sessionId}
                onClick={() => {
                  if (!projectId || !sessionId) return
                  setEditing(false)
                  void editAndResend(projectId, sessionId, msg.id, draft)
                }}
              >
                {t('chat.saveAndResend')}
              </button>
            </div>
          </div>
        ) : isLive && msg.role === 'assistant' ? (
          <StreamingMarkdown text={content} />
        ) : (
          <div className={`message-content${isStreamingTail ? ' streaming' : ''}`}>
            <MarkdownRenderer content={content} />
          </div>
        )}
        <div className="message-actions">
          <button
            className={`message-copy ${copied ? 'copied' : ''}`}
            onClick={() => void handleCopy()}
            title={t('chat.copy')}
            aria-label={t('chat.copy')}
          >
            {copied ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? t('chat.copied') : t('chat.copy')}
          </button>
          {canAct && msg.role === 'user' && !isLive && (
            <button
              type="button"
              className="message-action-btn"
              onClick={() => {
                setDraft(stripDisplayImages(msg.content))
                setEditing(true)
              }}
            >
              {t('chat.edit')}
            </button>
          )}
          {canAct && msg.role === 'assistant' && !isLive && projectId && sessionId && (
            <button
              type="button"
              className="message-action-btn"
              onClick={() => void regenerate(projectId, sessionId, msg.id)}
            >
              {t('chat.regenerate')}
            </button>
          )}
        </div>
      </div>
      {msg.role === 'assistant' && msg.modelLabel && !isLive && (
        <div className="message-model-label">{msg.modelLabel}</div>
      )}
    </div>
  )
})

export default function MessageList({
  messages,
  isStreaming,
  endRef,
  startIndex,
  nearTop,
  onShowEarlier,
  onScroll,
  sessionKey,
  projectId,
  sessionId
}: MessageListProps): React.JSX.Element {
  const { t } = useTranslation()
  const sessionBusy = useChatStore((s) =>
    sessionId ? s.streamingSessionIds.includes(sessionId) : s.isStreaming
  )
  const busy = isStreaming || sessionBusy
  const visible = startIndex > 0 ? messages.slice(startIndex) : messages
  const now = Date.now()
  const isFresh = (msg: Message): boolean =>
    typeof msg.createdAt === 'number' && now - msg.createdAt < 900
  const lastId = messages[messages.length - 1]?.id
  const lastRole = messages[messages.length - 1]?.role

  type RenderItem =
    | { kind: 'message'; msg: Message }
    | { kind: 'tool-batch'; id: string; messages: Message[] }

  const renderItems: RenderItem[] = []
  for (const msg of visible) {
    if (msg.role === 'system') {
      const last = renderItems[renderItems.length - 1]
      if (last && last.kind === 'tool-batch') {
        last.messages.push(msg)
      } else {
        renderItems.push({ kind: 'tool-batch', id: `batch-${msg.id}`, messages: [msg] })
      }
    } else {
      renderItems.push({ kind: 'message', msg })
    }
  }

  return (
    <div className="chat-messages" onScroll={onScroll} data-session={sessionKey || ''}>
      {startIndex > 0 && nearTop && (
        <button className="message-load-earlier" onClick={onShowEarlier}>
          {t('chat.showEarlier', { count: startIndex })}
        </button>
      )}
      {renderItems.map((item) => (
        <MessageErrorBoundary key={item.kind === 'message' ? item.msg.id : item.id}>
          {item.kind === 'message' ? (
            <MessageRow
              msg={item.msg}
              animateIn={isFresh(item.msg)}
              isStreamingTail={busy && item.msg.id === lastId && item.msg.role === 'assistant'}
              projectId={projectId}
              sessionId={sessionId}
              canAct={!busy && Boolean(projectId && sessionId)}
            />
          ) : (
            <ToolBatch
              messages={item.messages}
              animateIn={item.messages.some((m) => isFresh(m))}
            />
          )}
        </MessageErrorBoundary>
      ))}
      {busy && lastRole !== 'assistant' && (
        <div className="message assistant message-enter">
          <div className="message-role">{t('chat.assistant')}</div>
          <div className="message-content streaming">
            <span className="cursor-blink">▍</span>
          </div>
        </div>
      )}
      <SubagentActivity sessionId={sessionId} />
      <div ref={endRef} />
    </div>
  )
}
