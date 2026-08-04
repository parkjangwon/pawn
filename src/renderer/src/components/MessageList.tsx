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
}

// Memoized per message: during streaming only the changed message re-renders,
// so long chats no longer re-parse every markdown block on each token.
const MessageRow = memo(function MessageRow({ msg }: { msg: Message }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  // Live streaming text lives in a dedicated store; falls back to the persisted
  // content once the round ends.
  const live = useStreamingStore((s) => s.content[msg.id])
  const content = live ?? msg.content
  // User bubbles embed display-only data-URL images; the clipboard copy should
  // carry the actual text, not megabyte base64 blobs.
  const copyText = msg.role === 'user' ? stripDisplayImages(msg.content) : msg.content

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be unavailable (permissions, web preview); ignore.
    }
  }

  // Tool call logs get their own collapsed-by-default row (icon + status,
  // expand for the raw output) instead of a full message bubble — a turn
  // with several tool calls would otherwise dump each one open at full height.
  if (msg.role === 'system') {
    return (
      <div className="message system">
        <ToolMessage content={content} />
      </div>
    )
  }

  return (
    <div className={`message ${msg.role}`}>
      <div className="message-role">{msg.role === 'user' ? t('chat.you') : t('chat.assistant')}</div>
      <div className="message-body">
        <div className="message-content">
          {/* User bubbles render as markdown too: attached images come through as
              inline data-URL images (safeHref/CSP still apply). */}
          <MarkdownRenderer content={content} />
        </div>
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
