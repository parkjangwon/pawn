import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useUsageStore, formatCost, formatTokens, type CacheDiagnostic } from '../stores/usage'
import MarkdownRenderer from './MarkdownRenderer'
import TriggerMenu, { type TriggerItem } from './TriggerMenu'
import { loadProjectContext, type LoadedSkill } from '../agent/skills'
import './ChatArea.css'

interface ChatAreaProps {
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

export default function ChatArea({ onToggleSidebar, onOpenSettings }: ChatAreaProps): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [sendMode, setSendMode] = useState<'queue' | 'steer'>(() => useProviderStore.getState().defaultSendMode)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showPermPicker, setShowPermPicker] = useState(false)
  const { projects, activeProjectId, activeSessionId, setActiveProject, addProject, addSession, clearMessages } = useAppStore()
  const { sendMessage, isStreaming, stopStreaming } = useChatStore()
  const { models, providers, activeModelId, setActiveModel, permissionMode, setPermissionMode, reasoningEffort, setReasoningEffort, routingMode, setRoutingMode } = useProviderStore()
  const { toggle: toggleTheme } = useThemeStore()
  const usageTotals = useUsageStore((s) => (activeSessionId ? s.bySession[activeSessionId] : undefined))
  const lastRoute = useUsageStore((s) => (activeSessionId ? s.lastRoute[activeSessionId] : undefined))
  const sessionDiags = useUsageStore((s) => (activeSessionId ? s.diagnostics[activeSessionId] : undefined))
  const [showUsagePopover, setShowUsagePopover] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const projectPickerRef = useRef<HTMLDivElement>(null)
  const permPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const usageRef = useRef<HTMLDivElement>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<{ type: '/' | '@'; start: number; query: string } | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [fileIndex, setFileIndex] = useState<Array<{ name: string; path: string; rel: string }>>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [skills, setSkills] = useState<LoadedSkill[]>([])
  const pendingCursor = useRef<number | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  const effectivePath = activeProject?.paths?.[0] || ''

  // Current model info
  const currentModel = models.find((m) => m.id === activeModelId) || models.find((m) => m.enabled)
  const currentModelLabel = currentModel?.label || currentModel?.modelId || 'No model'
  const currentProviderName = providers.find((p) => p.id === currentModel?.providerId)?.name || ''

  const permLabels: Record<string, string> = { ask: '승인 요청', auto: '자동 승인', yolo: '전체 권한' }
  const permDescs: Record<string, string> = { ask: '외부 파일 수정 전 확인', auto: '위험한 것만 확인', yolo: '모든 작업 자동 실행' }
  const reasoningLabels: Record<string, string> = { auto: '추론 자동', low: '추론 낮음', medium: '추론 중간', high: '추론 높음' }
  const reasoningDescs: Record<string, string> = { auto: '작업에 따라 자동 선택', low: '빠른 응답', medium: '균형', high: '깊은 사고' }

  // Detect git branch
  useEffect(() => {
    if (!effectivePath) { setGitBranch(null); return }
    window.api.shell.exec('git rev-parse --abbrev-ref HEAD', effectivePath)
      .then((r) => { if (r.exitCode === 0) setGitBranch(r.stdout.trim()); else setGitBranch(null) })
      .catch(() => setGitBranch(null))
  }, [effectivePath])

  // Current model label
  // Scroll to bottom on new messages AND on content updates (streaming).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming, messages[messages.length - 1]?.content])

  // Close any open dropdown when the user presses outside of it.
  const anyDropdownOpen = showProjectPicker || showPermPicker || showModelPicker || showUsagePopover
  useEffect(() => {
    if (!anyDropdownOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      const refs = [projectPickerRef, permPickerRef, modelPickerRef, usageRef]
      if (refs.some((r) => r.current && r.current.contains(target))) return
      setShowProjectPicker(false)
      setShowPermPicker(false)
      setShowModelPicker(false)
      setShowUsagePopover(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anyDropdownOpen])

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

 const handleSelectProject = (projectId: string): void => {
   setActiveProject(projectId)
   setShowProjectPicker(false)
 }

  // --- Slash (/) commands and @ file mentions ---
  const buildSlash = (): TriggerItem[] => {
    const ic = (d: React.ReactNode): React.ReactNode => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
    )
    return [
      {
        id: 'new', label: t('chat.slash.new'), description: t('chat.slash.newDesc'),
        icon: ic(<><path d="M12 5v14" /><path d="M5 12h14" /></>),
        action: () => {
          let pid = activeProjectId
          if (!pid) {
            let g = projects.find((p) => p.id === '__general__')
            if (!g) { addProject('General', [], '__general__'); g = useAppStore.getState().projects.find((p) => p.id === '__general__') }
            pid = g?.id || useAppStore.getState().activeProjectId || ''
          }
          if (pid) addSession(pid)
        }
      },
      {
        id: 'clear', label: t('chat.slash.clear'), description: t('chat.slash.clearDesc'),
        icon: ic(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>),
        action: () => { if (activeProjectId && activeSessionId) clearMessages(activeProjectId, activeSessionId) }
      },
      {
        id: 'model', label: t('chat.slash.model'), description: t('chat.slash.modelDesc'),
        icon: ic(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" /></>),
        action: () => { setShowModelPicker(true); setShowPermPicker(false) }
      },
      {
        id: 'theme', label: t('chat.slash.theme'), description: t('chat.slash.themeDesc'),
        icon: ic(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.9 4.9l1.4 1.4" /><path d="M17.7 17.7l1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /></>),
        action: () => toggleTheme()
      },
      {
        id: 'settings', label: t('chat.slash.settings'), description: t('chat.slash.settingsDesc'),
        icon: ic(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
        action: () => onOpenSettings()
      },
      {
        id: 'export', label: t('chat.slash.export'), description: t('chat.slash.exportDesc'),
        icon: ic(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
        action: () => handleExport()
      },
      ...skills.map((s) => {
        const firstLine = (s.content.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('---') && !l.startsWith('#')) || s.source.split('/').pop() || '').slice(0, 60)
        return {
          id: `skill:${s.name}`,
          label: s.name,
          description: firstLine,
          hint: 'skill',
          insert: `/${s.name} `,
          icon: ic(<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.7 1.9L21.5 17l-1.8.7L19 19.5l-.7-1.8L16.5 17l1.8-.7z" /></>)
        }
      })
    ]
  }

  const mentionItems = useMemo<TriggerItem[]>(() => fileIndex.map((f) => ({
    id: f.rel,
    label: f.name,
    description: f.rel !== f.name ? f.rel : undefined,
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
  })), [fileIndex])

  const loadFiles = async (): Promise<void> => {
    if (!effectivePath) return
    setFilesLoading(true)
    try {
      const res = await window.api.fs.walk(effectivePath)
      if (Array.isArray(res)) {
        const base = effectivePath.endsWith('/') ? effectivePath : effectivePath + '/'
        setFileIndex(res.map((f) => ({ name: f.name, path: f.path, rel: f.path.startsWith(base) ? f.path.slice(base.length) : f.name })))
      }
    } finally {
      setFilesLoading(false)
    }
  }

  const getItems = (): TriggerItem[] => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    const base = trigger.type === '/' ? buildSlash() : mentionItems
    if (!q) return base
    return base.filter((it) =>
      it.id.toLowerCase().includes(q) || it.label.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q)
    )
  }

  useEffect(() => { setFileIndex([]) }, [effectivePath])

  useEffect(() => {
    if (!effectivePath) { setSkills([]); return }
    loadProjectContext(effectivePath).then((c) => setSkills(c.skills)).catch(() => setSkills([]))
  }, [effectivePath])

  function handleSelect(item: TriggerItem): void {
    if (!trigger) return
    const value = input
    const cursor = textareaRef.current?.selectionStart ?? value.length
    if (trigger.type === '/') {
      if (item.insert) {
        setInput(value.slice(0, trigger.start) + item.insert + value.slice(cursor))
        pendingCursor.current = trigger.start + item.insert.length
      } else {
        setInput(value.slice(0, trigger.start) + value.slice(cursor))
        item.action?.()
      }
      setTrigger(null)
      setMenuIndex(0)
    } else {
      const insertion = '@' + item.id + ' '
      setInput(value.slice(0, trigger.start) + insertion + value.slice(cursor))
      pendingCursor.current = trigger.start + insertion.length
      setTrigger(null)
      setMenuIndex(0)
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
      if (pendingCursor.current !== null) {
        textareaRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current)
        pendingCursor.current = null
      }
    }
  }, [input])

  const handleSend = async (): Promise<void> => {
    if (!input.trim()) return

    let projectId = activeProjectId
    let sessionId = activeSessionId

    // Auto-create project + session if none active
    if (!projectId || !sessionId) {
      // Find or create general project
      let general = projects.find((p) => p.id === '__general__')
      if (!general) {
        addProject('General', [], '__general__')
        // addProject sets activeProjectId, get it from store after state update
        // We need to use the store directly since state hasn't updated yet
        const store = useAppStore.getState()
        general = store.projects.find((p) => p.id === '__general__')
        projectId = general?.id || store.activeProjectId || ''
      } else {
        projectId = general.id
      }

      // Create session with first message as title
      const title = input.trim().slice(0, 40) + (input.trim().length > 40 ? '...' : '')
      addSession(projectId, title)
      const store = useAppStore.getState()
      sessionId = store.activeSessionId || ''
      projectId = store.activeProjectId || projectId
    }

    if (!projectId || !sessionId) return

    // Resolve @file mentions into inline context blocks (only known project files)
    const pathByRel = new Map(fileIndex.map((f) => [f.rel, f.path]))
    const tokens = [...new Set((input.match(/@(\S+)/g) || []).map((tok) => tok.slice(1)))]
    const blocks: string[] = []
    for (const rel of tokens) {
      const abs = pathByRel.get(rel)
      if (!abs) continue
      const r = await window.api.fs.readFile(abs)
      if (typeof r === 'string') blocks.push(`<file path="${rel}">\n${r}\n</file>`)
    }
    const skillByName = new Map(skills.map((s) => [s.name, s]))
    const slashTokens = [...new Set((input.match(/\/([^\s/]+)/g) || []).map((tok) => tok.slice(1)))]
    for (const name of slashTokens) {
      const sk = skillByName.get(name)
      if (sk) blocks.push(`<skill name="${name}">\n${sk.content}\n</skill>`)
    }
    const finalContent = blocks.length ? blocks.join('\n\n') + '\n\n' + input.trim() : input.trim()

    sendMessage(projectId, sessionId, finalContent, sendMode)
    setInput('')
    setTrigger(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    setInput(value)
    const cursor = e.target.selectionStart ?? value.length
    const before = value.slice(0, cursor)
    const m = before.match(/(^|\s)([/@])([^\s]*)$/)
    if (m) {
      const type = m[2] as '/' | '@'
      const start = cursor - m[0].length + m[1].length
      setTrigger({ type, start, query: m[3] })
      setMenuIndex(0)
      if (type === '@' && fileIndex.length === 0 && !filesLoading && effectivePath) loadFiles()
    } else {
      setTrigger(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    const items = getItems()
    if (trigger && items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIndex((i) => Math.min(i + 1, items.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSelect(items[Math.min(menuIndex, items.length - 1)]); return }
      if (e.key === 'Escape') { e.preventDefault(); setTrigger(null); return }
    } else if (trigger && e.key === 'Escape') {
      e.preventDefault(); setTrigger(null); return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const suggestions = [
    { icon: 'code', text: t('chat.suggestions.summarize') },
    { icon: 'globe', text: t('chat.suggestions.searchWeb') },
    { icon: 'file', text: t('chat.suggestions.draftEmail') },
    { icon: 'calendar', text: t('chat.suggestions.setupAutomation') },
    { icon: 'monitor', text: t('chat.suggestions.screenshot') },
    { icon: 'edit', text: t('chat.suggestions.writeReport') },
  ]

  const triggerItems = getItems()
  const triggerOpen = trigger !== null

  return (
    <main className="chat-area">
      <div className="chat-header">
        <button className="sidebar-toggle-btn close-sidebar-btn" onClick={onToggleSidebar} aria-label="Open sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <div className="chat-header-spacer" />
        <button className="sidebar-toggle-btn right-panel-toggle" onClick={() => (window as any).__toggleRightPanel?.()} aria-label="Toggle right panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </div>

      {!activeSession || messages.length === 0 ? (
        <div className="chat-welcome">
          <div className="welcome-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1>{activeProject ? t('chat.welcomeProject', { name: activeProject.name }) : t('chat.welcome')}</h1>
          {!activeProject && <p>{t('chat.welcomeSub')}</p>}
          <div className="welcome-actions">
            {suggestions.map((s, i) => (
              <button key={i} className="welcome-btn" onClick={() => { setInput(s.text); setTrigger(null) }}>
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
          <TriggerMenu
            open={triggerOpen}
            trigger={trigger?.type ?? null}
            items={triggerItems}
            selectedIndex={Math.min(menuIndex, Math.max(triggerItems.length - 1, 0))}
            loading={trigger?.type === '@' && filesLoading}
            emptyText={trigger?.type === '@' ? t('chat.mention.noResults') : t('chat.slash.noResults')}
            title={trigger?.type === '@' ? t('chat.mention.title') : t('chat.slash.title')}
            onSelect={handleSelect}
            onHover={setMenuIndex}
          />
          {/* Context chips bar */}
          {activeSession && (
            <div className="context-bar">
              <div className="context-chip-wrapper" ref={projectPickerRef}>
                <button className="context-chip project-chip" onClick={() => { setShowProjectPicker(!showProjectPicker); setShowPermPicker(false); setShowModelPicker(false); setShowUsagePopover(false) }} title="Switch project">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  <span>{activeProject?.name || 'No project'}</span>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {showProjectPicker && (
                  <div className="project-picker">
                    <div className="picker-list">
                      {projects.filter((p) => p.id !== '__general__').map((p) => (
                        <button
                          key={p.id}
                          className={`picker-item ${p.id === activeProjectId ? 'active' : ''}`}
                          onClick={() => handleSelectProject(p.id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                          <span>{p.name}</span>
                          {p.paths?.[0] && <span className="picker-path">{p.paths[0].split('/').pop()}</span>}
                          {p.id === activeProjectId && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                        </button>
                      ))}
                    </div>
                    <div className="picker-footer">
                      <button className="picker-item" onClick={() => { handleSelectProject('__general__') }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        <span>프로젝트 없이 작업하기</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {gitBranch && (
                <span className="context-chip branch-chip">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
                  <span>{gitBranch}</span>
                </span>
              )}
            </div>
          )}

          {/* Text input */}
          <div className="chat-input-box">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.placeholder')}
              rows={1}
            />
            <div className="input-actions">
              {/* Left: permission mode */}
              <div className="input-actions-left">
                <div className="context-chip-wrapper" ref={permPickerRef}>
                  <button className={`perm-chip perm-${permissionMode}`} onClick={() => { setShowPermPicker(!showPermPicker); setShowProjectPicker(false); setShowModelPicker(false); setShowUsagePopover(false) }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    <span>{permLabels[permissionMode]}</span>
                  </button>
                  {showPermPicker && (
                    <div className="project-picker perm-picker">
                      {(['ask', 'auto', 'yolo'] as const).map((mode) => (
                        <button key={mode} className={`picker-item ${permissionMode === mode ? 'active' : ''}`} onClick={() => { setPermissionMode(mode); setShowPermPicker(false) }}>
                          <span className="picker-item-label">{permLabels[mode]}</span>
                          <span className="picker-item-desc">{permDescs[mode]}</span>
                          {permissionMode === mode && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: model + send */}
              <div className="input-actions-right">
                {messages.length > 0 && (
                  <button className="input-action-btn" onClick={handleExport} title="Export">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                )}
                {usageTotals && usageTotals.calls > 0 && (
                  <div className="context-chip-wrapper" ref={usageRef}>
                    <button
                      className="context-chip usage-chip"
                      onClick={() => { setShowUsagePopover(!showUsagePopover); setShowProjectPicker(false); setShowPermPicker(false); setShowModelPicker(false) }}
                      title={lastRoute ? `${lastRoute.label} — ${lastRoute.reason}` : undefined}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      <span>{formatCost(usageTotals.cost)}</span>
                      {usageTotals.cacheHitRate > 0.01 && (
                        <span className="usage-chip-cache">· {Math.round(usageTotals.cacheHitRate * 100)}% cached</span>
                      )}
                    </button>
                    {showUsagePopover && (
                      <div className="project-picker usage-popover">
                        <div className="picker-item-label">이번 세션 사용량</div>
                        <div className="usage-popover-row"><span>입력</span><span>{formatTokens(usageTotals.inputTokens)}</span></div>
                        <div className="usage-popover-row"><span>출력</span><span>{formatTokens(usageTotals.outputTokens)}</span></div>
                        <div className="usage-popover-row"><span>캐시 읽기</span><span>{formatTokens(usageTotals.cacheReadTokens)}</span></div>
                        <div className="usage-popover-row"><span>캐시 기록</span><span>{formatTokens(usageTotals.cacheWriteTokens)}</span></div>
                        <div className="usage-popover-row"><span>캐시 적중률</span><span>{Math.round(usageTotals.cacheHitRate * 100)}%</span></div>
                        <div className="usage-popover-row total"><span>총 비용</span><span>{formatCost(usageTotals.cost)}</span></div>
                       {lastRoute && <div className="usage-popover-route">{lastRoute.label} — {lastRoute.reason}</div>}
                        {sessionDiags && sessionDiags.length > 0 && (
                          <div className="usage-diagnostics">
                            {sessionDiags.slice(-4).map((d: CacheDiagnostic, i: number) => (
                              <div key={i} className={`usage-diagnostic ${d.level}`}>
                                <span className="diagnostic-icon">{d.level === 'warn' ? '⚠' : '✓'}</span>
                                <span>{d.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                     </div>
                    )}
                  </div>
                )}
                <div className="context-chip-wrapper" ref={modelPickerRef}>
                  <button className="context-chip model-chip-btn" onClick={() => { setShowModelPicker(!showModelPicker); setShowProjectPicker(false); setShowPermPicker(false); setShowUsagePopover(false) }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                    <span>{routingMode === 'auto' ? t('modelPicker.autoLabel') : currentModelLabel}</span>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  {showModelPicker && (
                    <div className="project-picker model-picker">
                      <button className={`picker-item ${routingMode === 'auto' ? 'active' : ''}`} onClick={() => { setActiveModel(null); setRoutingMode('auto'); setShowModelPicker(false) }}>
                        <span className="picker-item-label">{t('modelPicker.autoLabel')}</span>
                        <span className="picker-item-desc">{t('modelPicker.autoDesc')}</span>
                        {routingMode === 'auto' && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                      </button>
                      {providers.filter((p) => p.enabled).map((provider) => (
                        <div key={provider.id} className="picker-group">
                          <div className="picker-group-label">{provider.name}</div>
                          {models.filter((m) => m.providerId === provider.id && m.enabled).map((m) => (
                            <button key={m.id} className={`picker-item ${m.id === activeModelId ? 'active' : ''}`} onClick={() => { setActiveModel(m.id); setShowModelPicker(false) }}>
                              <span>{m.label || m.modelId}</span>
                              {m.id === activeModelId && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                            </button>
                          ))}
                        </div>
                      ))}
                      {models.filter((m) => m.enabled).length === 0 && (
                        <div className="picker-empty">{t('modelPicker.noModels')}</div>
                      )}
                      <div className="picker-group">
                        <div className="picker-group-label">{t('modelPicker.reasoningLabel')}</div>
                        {(['auto', 'low', 'medium', 'high'] as const).map((e) => (
                          <button key={e} className={`picker-item ${reasoningEffort === e ? 'active' : ''}`} onClick={() => { setReasoningEffort(e); setShowModelPicker(false) }}>
                            <span className="picker-item-label">{reasoningLabels[e]}</span>
                            <span className="picker-item-desc">{reasoningDescs[e]}</span>
                            {reasoningEffort === e && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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
      </div>
    </main>
  )
}
