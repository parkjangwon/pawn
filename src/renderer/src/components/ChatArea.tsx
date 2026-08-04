import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useStreamingStore } from '../stores/streaming'
import type { TriggerItem } from './TriggerMenu'
import ProjectEditDialog from './ProjectEditDialog'
import { loadProjectContext, type LoadedSkill } from '../agent/skills'
import ChatHeader from './ChatHeader'
import WelcomeScreen from './WelcomeScreen'
import MessageList from './MessageList'
import Composer from './Composer'
import ConfirmDialog from './ConfirmDialog'
import { filterEnabledSkills } from '../utils/skillVisibility'
import { MAX_ATTACHMENTS, type ChatAttachment } from '../utils/attachments'
import './ChatArea.css'

interface ChatAreaProps {
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

// Long sessions render only the tail; scrolling to the top reveals older
// messages in batches. New messages always append to the visible window.
const DEFAULT_VISIBLE_MESSAGES = 300
const EARLIER_BATCH = 300

export default function ChatArea({ onToggleSidebar, onOpenSettings }: ChatAreaProps): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [sendMode, setSendMode] = useState<'queue' | 'steer'>(() => useProviderStore.getState().defaultSendMode)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showPermPicker, setShowPermPicker] = useState(false)
  const { projects, activeProjectId, activeSessionId, setActiveProject, addProject, addSession, clearMessages, updateProjectName } = useAppStore()
  const { sendMessage, isStreaming, stopStreaming } = useChatStore()
  const { models, providers, activeModelId, setActiveModel, permissionMode, setPermissionMode, reasoningEffort, setReasoningEffort, routingMode, setRoutingMode } = useProviderStore()
  const { toggle: toggleTheme } = useThemeStore()
  const [showUsagePopover, setShowUsagePopover] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const lastMessageIdRef = useRef<string | undefined>(undefined)
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
  const [startIndex, setStartIndex] = useState<number | null>(null)
  const [nearTop, setNearTop] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const [showProjectEdit, setShowProjectEdit] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const pendingCursor = useRef<number | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  const effectivePath = activeProject?.paths?.[0] || ''
  const lastMessage = messages[messages.length - 1]
  const tailStart = Math.max(0, messages.length - DEFAULT_VISIBLE_MESSAGES)
  const effectiveStart = startIndex === null
    ? tailStart
    : Math.min(startIndex, messages.length)
  const streamingTail = useStreamingStore((s) => (lastMessage ? s.content[lastMessage.id] : undefined))

  const addAttachment = (a: ChatAttachment): void => {
    setAttachments((prev) => (prev.length >= MAX_ATTACHMENTS ? prev : [...prev, a]))
  }

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // Detect git branch
  useEffect(() => {
    if (!effectivePath) { setGitBranch(null); return }
    window.api.shell.exec('git rev-parse --abbrev-ref HEAD', effectivePath)
      .then((r) => { if (r.exitCode === 0) setGitBranch(r.stdout.trim()); else setGitBranch(null) })
      .catch(() => setGitBranch(null))
  }, [effectivePath])

  // Current model label
  // Scroll to bottom on new messages AND on content updates (streaming). While
  // streaming, jump instantly instead of restarting a smooth animation on every
  // token, and never yank the view away when the user has scrolled up.
  const lastMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (lastMessageIdRef.current !== lastMessageId) {
      lastMessageIdRef.current = lastMessageId
      stickToBottomRef.current = true
    }
  }, [lastMessageId])

  // A new session starts with a tail-only window.
  useEffect(() => {
    setStartIndex(null)
    setNearTop(false)
  }, [activeSessionId])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' })
  }, [messages.length, isStreaming, lastMessage?.content, streamingTail])

  const handleMessageScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickToBottomRef.current = nearBottom
    setNearTop(el.scrollTop < 40)
    // Reached the bottom: drop the earlier-messages window and follow the tail.
    if (nearBottom && startIndex !== null) setStartIndex(null)
  }

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
        action: () => { if (activeProjectId && activeSessionId) setShowClearConfirm(true) }
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
      ...skills
        .filter((s) => !['new', 'clear', 'model', 'theme', 'settings', 'export'].includes(s.name.toLowerCase()))
        .map((s) => {
        const firstLine = (s.content.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('---') && !l.startsWith('#')) || s.source.split('/').pop() || '').slice(0, 60)
        return {
          id: `skill:${s.name}`,
          label: s.name,
          description: firstLine,
          hint: s.kind === 'command' || s.kind === 'plugin' || s.kind === 'agent' ? s.kind : 'skill',
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
    // User-level (~/.claude) skills and commands load even without a project.
    loadProjectContext(effectivePath || undefined).then((c) => setSkills(filterEnabledSkills(c.skills))).catch(() => setSkills([]))
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

  // Close project menu on outside click
  useEffect(() => {
    if (!showProjectMenu) return
    const handler = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) setShowProjectMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showProjectMenu])

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

    sendMessage(projectId, sessionId, finalContent, sendMode, attachments)
    setInput('')
    setAttachments([])
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
      <ChatHeader
        onToggleSidebar={onToggleSidebar}
        projectName={activeProject?.name}
        gitBranch={gitBranch}
        projectPath={effectivePath}
      />
      {!activeSession || messages.length === 0 ? (
        <WelcomeScreen
          activeProject={activeProject}
          suggestions={suggestions}
          onPick={(text) => { setInput(text); setTrigger(null) }}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          endRef={messagesEndRef}
          startIndex={effectiveStart}
          nearTop={nearTop}
          onShowEarlier={() => setStartIndex(Math.max(0, effectiveStart - EARLIER_BATCH))}
          onScroll={handleMessageScroll}
        />
      )}
      <Composer
        activeSession={!!activeSession}
        activeSessionId={activeSessionId}
        input={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        textareaRef={textareaRef}
        trigger={trigger}
        triggerItems={triggerItems}
        menuIndex={menuIndex}
        onMenuIndexChange={setMenuIndex}
        filesLoading={filesLoading}
        onSelect={handleSelect}
        projects={projects}
        activeProject={activeProject}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        showProjectPicker={showProjectPicker}
        setShowProjectPicker={setShowProjectPicker}
        showPermPicker={showPermPicker}
        setShowPermPicker={setShowPermPicker}
        showModelPicker={showModelPicker}
        setShowModelPicker={setShowModelPicker}
        showUsagePopover={showUsagePopover}
        setShowUsagePopover={setShowUsagePopover}
        projectPickerRef={projectPickerRef}
        permPickerRef={permPickerRef}
        modelPickerRef={modelPickerRef}
        usageRef={usageRef}
        isStreaming={isStreaming}
        onStop={stopStreaming}
        attachments={attachments}
        onAddAttachment={addAttachment}
        onRemoveAttachment={removeAttachment}
      />
      {showProjectEdit && activeProjectId && (
        <ProjectEditDialog projectId={activeProjectId} onClose={() => setShowProjectEdit(false)} />
      )}
      {showClearConfirm && (
        <ConfirmDialog
          title={t('chat.slash.clear')}
          message={t('confirmDialog.clearSessionConfirm')}
          confirmLabel={t('confirmDialog.confirm')}
          cancelLabel={t('confirmDialog.cancel')}
          onConfirm={() => {
            if (activeProjectId && activeSessionId) clearMessages(activeProjectId, activeSessionId)
            setShowClearConfirm(false)
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </main>
  )
}
