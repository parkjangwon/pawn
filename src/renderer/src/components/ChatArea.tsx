import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import './ChatArea.css'

export default function ChatArea(): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const { projects, activeProjectId, activeSessionId, addMessage } = useAppStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)

  const handleSend = (): void => {
    if (!input.trim() || !activeProjectId || !activeSessionId) return
    addMessage(activeProjectId, activeSessionId, {
      id: `${Date.now()}`,
      role: 'user',
      content: input.trim(),
      createdAt: Date.now()
    })
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <main className="chat-area">
      {!activeSession ? (
        <div className="chat-welcome">
          <h1>{t('chat.welcome')}</h1>
          <p>{t('chat.welcomeSub')}</p>
        </div>
      ) : (
        <div className="chat-messages">
          {activeSession.messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-content">{msg.content}</div>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-wrapper">
        <div className="chat-input-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
          />
          <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
            ↑
          </button>
        </div>
      </div>
    </main>
  )
}
