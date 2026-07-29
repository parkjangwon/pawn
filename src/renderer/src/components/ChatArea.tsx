import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { useProviderStore } from '../stores/provider'
import MarkdownRenderer from './MarkdownRenderer'
import FileBrowser from './FileBrowser'
import './ChatArea.css'

interface ChatAreaProps {
  onToggleSidebar: () => void
}

export default function ChatArea({ onToggleSidebar }: ChatAreaProps): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [sendMode, setSendMode] = useState<'queue' | 'steer'>('queue')
  const { projects, activeProjectId, activeSessionId, updateSessionPath } = useAppStore()
  const { sendMessage, isStreaming, stopStreaming } = useChatStore()
  const { models } = useProviderStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [gitBranch, setGitBranch] = useState<string | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  const effectivePath = activeSession?.path || activeProject?.path || ''

  // Detect git branch
  useEffect(() => {
    if (!effectivePath) { setGitBranch(null); return }
    window.api.shell.exec('git rev-parse --abbrev-ref HEAD', effectivePath)
      .then((r) => { if (r.exitCode === 0) setGitBranch(r.stdout.trim()); else setGitBranch(null) })
      .catch(() => setGitBranch(null))
  }, [effectivePath])

  // Current model label
  const activeModel = models.find((m) => m.enabled)
  const modelLabel = activeModel?.label || activeModel?.modelId || ''

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming])

  const handleExport = (): void => {
    if (!activeSession || messages.length === 0) return
    let md = `# ${activeSession.title}\n\n`
    for (const msg of messages) {
      if (msg.role === 'system') continue
      md += `## ${msg.role === 'user' ? 'You' : 'Assistant'}\n\n${msg.content}\n\n`
    }
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeSession.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleChangePath = (): void => {
    if (!activeProjectId || !activeSessionId) return
    setShowFileBrowser(true)
  }

  const handlePathSelected = (path: string): void => {
    if (activeProjectId && activeSessionId) {
      updateSessionPath(activeProjectId, activeSessionId, path)
    }
    setShowFileBrowser(false)
  }

  const handleClearPath = (): void => {
    if (!activeProjectId || !activeSessionId) return
    updateSessionPath(activeProjectId, activeSessionId, '')
  }

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

  const suggestions = [
    { icon: 'code', text: 'Read and summarize the project structure' },
    { icon: 'globe', text: 'Search the web for latest news on AI agents' },
    { icon: 'file', text: 'Draft a professional email reply' },
    { icon: 'calendar', text: 'Set up a daily automation task' },
    { icon: 'monitor', text: 'Take a screenshot and describe what you see' },
    { icon: 'edit', text: 'Help me write a report summary' },
  ]

  return (
    <main className="chat-area">
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={onToggleSidebar}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="mobile-title">Pawn</span>
      </div>

      {!activeSession || messages.length === 0 ? (
        <div className="chat-welcome">
          <div className="welcome-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1>{activeProject ? `What should we build in ${activeProject.name}?` : t('chat.welcome')}</h1>
          {!activeProject && <p>{t('chat.welcomeSub')}</p>}
          <div className="welcome-actions">
            {suggestions.map((s, i) => (
              <button key={i} className="welcome-btn" onClick={() => setInput(s.text)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {s.icon === 'code' && <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>}
                  {s.icon === 'globe' && <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>}
                  {s.icon === 'file' && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>}
                  {s.icon === 'calendar' && <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>}
                  {s.icon === 'monitor' && <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>}
                  {s.icon === 'edit' && <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>}
                </svg>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
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

      {/* Input area with context bar */}
      <div className="chat-input-wrapper">
        <div className="chat-input-container">
          {/* Context chips bar */}
          {activeSession && (
            <div className="context-bar">
              {activeProject && (
                <button className="context-chip project-chip" onClick={handleChangePath} title={effectivePath || 'Set path'}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  <span>{activeProject.name}</span>
                </button>
              )}
              {gitBranch && (
                <span className="context-chip branch-chip">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
                  <span>{gitBranch}</span>
                </span>
              )}
              {effectivePath && effectivePath !== activeProject?.path && (
                <button className="context-chip path-chip" onClick={handleChangePath} title={effectivePath}>
                  <span>{effectivePath.split('/').filter(Boolean).pop()}</span>
                  <span className="chip-clear" onClick={(e) => { e.stopPropagation(); if (confirm('Clear path?')) handleClearPath() }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </span>
                </button>
              )}
              {modelLabel && (
                <span className="context-chip model-chip">{modelLabel}</span>
              )}
            </div>
          )}

          {/* Text input */}
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
              {messages.length > 0 && (
                <button className="input-action-btn" onClick={handleExport} title="Export">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              )}
              <select
                className="mode-select"
                value={sendMode}
                onChange={(e) => setSendMode(e.target.value as 'queue' | 'steer')}
                disabled={isStreaming}
              >
                <option value="queue">Queue</option>
                <option value="steer">Steer</option>
              </select>
              {isStreaming ? (
                <button className="stop-btn" onClick={stopStreaming} title="Stop">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                </button>
              ) : (
                <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showFileBrowser && (
        <FileBrowser
          initialPath={effectivePath || activeProject?.path || '/'}
          onSelect={handlePathSelected}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </main>
  )
}
