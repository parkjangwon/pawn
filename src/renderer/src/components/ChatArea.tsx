import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import MarkdownRenderer from './MarkdownRenderer'
import './ChatArea.css'

interface ChatAreaProps {
  onToggleSidebar: () => void
}

export default function ChatArea({ onToggleSidebar }: ChatAreaProps): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [sendMode, setSendMode] = useState<'queue' | 'steer'>('queue')
  const { projects, activeProjectId, activeSessionId } = useAppStore()
  const { sendMessage, isStreaming, stopStreaming } = useChatStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = activeSession?.messages || []

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  const handleSend = (): void => {
    if (!input.trim() || !activeProjectId || !activeSessionId) return
    sendMessage(activeProjectId, activeSessionId, input.trim(), sendMode)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <main className="chat-area">
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={onToggleSidebar}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="mobile-title">hjcode Desktop</span>
      </div>

      {!activeSession ? (
        <div className="chat-welcome">
          <h1>{t('chat.welcome')}</h1>
          <p>{t('chat.welcomeSub')}</p>
        </div>
      ) : (
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
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="chat-input-wrapper">
        <div className="chat-input-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
          />
          <div className="input-actions">
            <select
              className="mode-select"
              value={sendMode}
              onChange={(e) => setSendMode(e.target.value as 'queue' | 'steer')}
              title="Send mode"
              disabled={isStreaming}
            >
              <option value="queue">Queue</option>
              <option value="steer">Steer</option>
            </select>
            {isStreaming ? (
              <button className="stop-btn" onClick={stopStreaming} title="Stop">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            ) : (
              <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
