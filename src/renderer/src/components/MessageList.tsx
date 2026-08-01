import { useTranslation } from 'react-i18next'
import MarkdownRenderer from './MarkdownRenderer'
import type { Message } from '../stores/app'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  endRef: React.RefObject<HTMLDivElement | null>
}

export default function MessageList({ messages, isStreaming, endRef }: MessageListProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-role">{msg.role === 'user' ? 'You' : 'Assistant'}</div>
              <div className="message-content">
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === 'assistant' && msg.modelLabel && (
                <div className="message-model-label">{msg.modelLabel}</div>
              )}
            </div>
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
