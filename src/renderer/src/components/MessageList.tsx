import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownRenderer from './MarkdownRenderer'
import ToolMessage from './ToolMessage'
import { useStreamingStore } from '../stores/streaming'
import { stripDisplayImages } from '../utils/attachments'
import type { Message } from '../stores/app'

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
}

/**
 * While tokens are streaming, skip full markdown/AST re-parse every frame.
 * Plain pre-wrap is much cheaper; final content uses MarkdownRenderer.
 */
const StreamingPlain = memo(function StreamingPlain({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <div className="message-content streaming message-content-live">
      <pre className="streaming-plaintext">
        {text}
        <span className="cursor-blink">▍</span>
      </pre>
    </div>
  )
})

// Memoized per message: during streaming only the changed message re-renders,
// so long chats no longer re-parse every markdown block on each token.
const MessageRow = memo(function MessageRow({
  msg,
  animateIn,
  isStreamingTail
}: {
  msg: Message
  animateIn?: boolean
  /** True when this row is the live streaming assistant bubble. */
  isStreamingTail?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const live = useStreamingStore((s) => s.content[msg.id])
  const content = live ?? msg.content
  const isLive = live !== undefined
  const copyText = msg.role === 'user' ? stripDisplayImages(msg.content) : msg.content
  const enterClass = animateIn ? ' message-enter' : ''

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
    <div className={`message ${msg.role}${enterClass}${isStreamingTail || isLive ? ' message-live' : ''}`}>
      <div className="message-role">{msg.role === 'user' ? t('chat.you') : t('chat.assistant')}</div>
      <div className="message-body">
        {isLive && msg.role === 'assistant' ? (
          <StreamingPlain text={content} />
        ) : (
          <div className={`message-content${isStreamingTail ? ' streaming' : ''}`}>
            <MarkdownRenderer content={content} />
          </div>
        )}
        <button
          className={`message-copy ${copied ? 'copied' : ''}`}
          onClick={() => void handleCopy()}
          title={t('chat.copy')}
          aria-label={t('chat.copy')}
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
          {copied ? t('chat.copied') : t('chat.copy')}
        </button>
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
  sessionKey
}: MessageListProps): React.JSX.Element {
  const { t } = useTranslation()
  const visible = startIndex > 0 ? messages.slice(startIndex) : messages
  const now = Date.now()
  const isFresh = (msg: Message): boolean =>
    typeof msg.createdAt === 'number' && now - msg.createdAt < 900
  const lastId = messages[messages.length - 1]?.id
  const lastRole = messages[messages.length - 1]?.role

  return (
    <div className="chat-messages" onScroll={onScroll} data-session={sessionKey || ''}>
      {startIndex > 0 && nearTop && (
        <button className="message-load-earlier" onClick={onShowEarlier}>
          {t('chat.showEarlier', { count: startIndex })}
        </button>
      )}
      {visible.map((msg) => (
        <MessageRow
          key={msg.id}
          msg={msg}
          animateIn={isFresh(msg)}
          isStreamingTail={isStreaming && msg.id === lastId && msg.role === 'assistant'}
        />
      ))}
      {isStreaming && lastRole !== 'assistant' && (
        <div className="message assistant message-enter">
          <div className="message-role">{t('chat.assistant')}</div>
          <div className="message-content streaming">
            <span className="cursor-blink">▍</span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
