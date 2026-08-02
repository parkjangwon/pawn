import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownRenderer from './MarkdownRenderer'
import { useStreamingStore } from '../stores/streaming'
import type { Message } from '../stores/app'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  endRef: React.RefObject<HTMLDivElement | null>
  startIndex: number
  nearTop: boolean
  onShowEarlier: () => void
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
}

// Memoized per message: during streaming only the changed message re-renders,
// so long chats no longer re-parse every markdown block on each token.
const MessageRow = memo(function MessageRow({ msg }: { msg: Message }): React.JSX.Element {
  const { t } = useTranslation()
  // Live streaming text lives in a dedicated store; falls back to the persisted
  // content once the round ends.
  const live = useStreamingStore((s) => s.content[msg.id])
  const content = live ?? msg.content
  return (
    <div className={`message ${msg.role}`}>
      <div className="message-role">{msg.role === 'user' ? t('chat.you') : t('chat.assistant')}</div>
      <div className="message-content">
        {msg.role === 'assistant' ? (
          <MarkdownRenderer content={content} />
        ) : (
          content
        )}
      </div>
      {msg.role === 'assistant' && msg.modelLabel && (
        <div className="message-model-label">{msg.modelLabel}</div>
      )}
    </div>
  )
})

export default function MessageList({
  messages, isStreaming, endRef, startIndex, nearTop, onShowEarlier, onScroll
}: MessageListProps): React.JSX.Element {
  const { t } = useTranslation()
  const visible = startIndex > 0 ? messages.slice(startIndex) : messages
  return (
    <div className="chat-messages" onScroll={onScroll}>
      {startIndex > 0 && nearTop && (
        <button className="message-load-earlier" onClick={onShowEarlier}>
          {t('chat.showEarlier', { count: startIndex })}
        </button>
      )}
      {visible.map((msg) => (
        <MessageRow key={msg.id} msg={msg} />
      ))}
      {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
        <div className="message assistant">
          <div className="message-role">Assistant</div>
          <div className="message-content streaming">
            <span className="cursor-blink">|</span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
