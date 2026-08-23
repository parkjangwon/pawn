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
import PlanStrip from './PlanStrip'
import TurnReviewBar from './TurnReviewBar'
import ConfirmDialog from './ConfirmDialog'
import { filterEnabledSkills } from '../utils/skillVisibility'
import { MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, truncateText, type ChatAttachment } from '../utils/attachments'
import {
  collectUserPrompts,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  navigatePromptHistory,
  pushPromptHistory
} from '../utils/promptHistory'
import { buildIssuePrPlaybook, parseIssuePrArg, prefetchIssueContext } from '../agent/issueWorkflow'
import './ChatArea.css'

interface ChatAreaProps {
  onToggleSidebar: () => void
  onOpenSettings: () => void
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
}

// Long sessions render only the tail; scrolling to the top reveals older
// messages in batches. New messages always append to the visible window.
// Smaller window = snappier switch + less markdown work (user can load earlier).
const DEFAULT_VISIBLE_MESSAGES = 100
const EARLIER_BATCH = 80

export default function ChatArea({
  onToggleSidebar, onOpenSettings, canGoBack, canGoForward, onGoBack, onGoForward
}: ChatAreaProps): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showPermPicker, setShowPermPicker] = useState(false)
  const { projects, activeProjectId, activeSessionId, setActiveProject, addProject, addSession, startNewChat, clearMessages, updateProjectName, loadedSessions, loadingSessions } = useAppStore()
  const { sendMessage, streamingSessionIds, stopStreaming } = useChatStore()
  /** Live tokens / thinking indicator only for the session currently on screen. */
  const sessionStreaming = !!activeSessionId && streamingSessionIds.includes(activeSessionId)
  const {
    models,
    providers,
    activeModelId,
    setActiveModel,
    defaultSendMode,
    permissionMode,
    setPermissionMode,
    reasoningEffort,
    setReasoningEffort,
    routingMode,
    setRoutingMode,
    toggleAgentMode,
    setAgentMode,
    hydrateSessionAgentMode
  } = useProviderStore()
  const { toggle: toggleTheme } = useThemeStore()
  const [showUsagePopover, setShowUsagePopover] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const lastMessageIdRef = useRef<string | undefined>(undefined)
  const scrollRafRef = useRef<number | null>(null)
  const [sessionPaneClass, setSessionPaneClass] = useState('session-pane')
  const projectPickerRef = useRef<HTMLDivElement>(null)
  const permPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const usageRef = useRef<HTMLDivElement>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<{ type: '/' | '@'; start: number; query: string } | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [fileIndex, setFileIndex] = useState<Array<{ name: string; path: string; rel: string; isDirectory?: boolean }>>([])
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
  /** Prevents double-submit while @mention expansion awaits IPC. */
  const sendingRef = useRef(false)
  /** Session-scoped user prompt history for ↑/↓ recall (oldest → newest). */
  const promptHistoryRef = useRef<Map<string, string[]>>(new Map())
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyDraftRef = useRef('')

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  // Prefer a user-selected root when multi-folder; fall back to primary.
  // Restore chip selection from session.path when switching sessions.
  const projectPaths = activeProject?.paths || []
  const [rootIndex, setRootIndex] = useState(0)
  useEffect(() => {
    const paths = activeProject?.paths || []
    const session = activeProject?.sessions.find((s) => s.id === activeSessionId)
    if (session?.path && paths.includes(session.path)) {
      setRootIndex(paths.indexOf(session.path))
    } else {
      setRootIndex(0)
    }
  }, [activeProject?.id, activeSessionId, activeProject?.paths, activeProject?.sessions])

  // Hydrate durable plan + per-session Plan/Build mode when focusing a session.
  useEffect(() => {
    if (!activeSessionId) return
    void hydrateSessionAgentMode(activeSessionId)
    void import('../stores/plan').then(({ usePlanStore }) => {
      void usePlanStore.getState().hydrate(activeSessionId)
    })
  }, [activeSessionId, hydrateSessionAgentMode])
  const effectivePath =
    projectPaths[Math.min(rootIndex, Math.max(0, projectPaths.length - 1))] ||
    projectPaths[0] ||
    ''
  const lastMessage = messages[messages.length - 1]
  const tailStart = Math.max(0, messages.length - DEFAULT_VISIBLE_MESSAGES)
  const effectiveStart = startIndex === null
    ? tailStart
    : Math.min(startIndex, messages.length)
  const streamingTail = useStreamingStore((s) => (lastMessage ? s.content[lastMessage.id] : undefined))

  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)

  const addAttachment = (a: ChatAttachment): void => {
    setAttachments((prev) => (prev.length >= MAX_ATTACHMENTS ? prev : [...prev, a]))
  }

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDraggingOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    for (const file of files.slice(0, MAX_ATTACHMENTS)) {
      if (file.type.startsWith('image/')) {
        if (file.size > MAX_IMAGE_BYTES) continue
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            addAttachment({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: file.name || t('chat.attachedImage'),
              kind: 'image',
              dataUrl: reader.result,
              bytes: file.size
            })
          }
        }
        reader.readAsDataURL(file)
      } else if (file.size <= MAX_TEXT_BYTES) {
        void file.text().then((content) => {
          addAttachment({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name || t('chat.attachedText'),
            kind: 'text',
            content: truncateText(content).text,
            bytes: file.size
          })
        }).catch(() => {})
      }
    }
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

  // A new session starts with a tail-only window; leave prompt-history browsing.
  useEffect(() => {
    setStartIndex(null)
    setNearTop(false)
    setHistoryIndex(-1)
    historyDraftRef.current = ''
    stickToBottomRef.current = true
    // Cross-fade pane on session switch
    setSessionPaneClass('session-pane session-pane-enter')
    const t = window.setTimeout(() => setSessionPaneClass('session-pane'), 220)
    return () => window.clearTimeout(t)
  }, [activeSessionId])

  // Scroll stick: one rAF max per frame during streaming (avoids layout thrash).
  useEffect(() => {
    if (!stickToBottomRef.current) return
    if (scrollRafRef.current !== null) return
    const smooth = !sessionStreaming
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      if (!stickToBottomRef.current) return
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
    })
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [messages.length, sessionStreaming, streamingTail])

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

  // Google-style "/" focus: when nothing is typing, jump into the composer.
  // Does not insert "/"; type it again after focus for slash commands.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      return Boolean(el.closest('[contenteditable="true"]'))
    }
    const isBlockedUi = (): boolean => {
      // Overlays that own keyboard input
      if (document.querySelector('.cp-overlay, .permission-overlay, .confirm-overlay, .settings-page')) {
        return true
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true
      return false
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.repeat) return
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return
      if (isBlockedUi()) return
      const ta = textareaRef.current
      if (!ta) return
      e.preventDefault()
      e.stopPropagation()
      ta.focus()
      const len = ta.value.length
      try {
        ta.setSelectionRange(len, len)
      } catch {
        /* ignore */
      }
    }
    // Capture so we win over other document listeners when appropriate
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const handleExport = (): void => {
    if (!activeSession || messages.length === 0) return
    const payload = {
      title: activeSession.title,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role,
          content: m.content,
          modelLabel: m.modelLabel
        }))
    }
    if (window.api?.exportSession) {
      void window.api
        .exportSession(payload)
        .then((r) => {
          if (r.ok && r.path) {
            try {
              window.dispatchEvent(
                new CustomEvent('pawn:toast', {
                  detail: { kind: 'info', message: `Exported → ${r.path}` }
                })
              )
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => {
          /* fall through browser path */
        })
      return
    }
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
          // Same as sidebar "New chat": never inherit the currently selected project.
          startNewChat()
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
      {
        id: 'plan', label: t('chat.slash.plan'), description: t('chat.slash.planDesc'),
        icon: ic(<><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><path d="M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2" /></>),
        action: () => setAgentMode('plan', activeSessionId)
      },
      {
        id: 'build', label: t('chat.slash.build'), description: t('chat.slash.buildDesc'),
        icon: ic(<><path d="M12 19V5M5 12l7-7 7 7" /></>),
        action: () => setAgentMode('build', activeSessionId)
      },
      {
        id: 'issue-pr',
        label: t('chat.slash.issuePr'),
        description: t('chat.slash.issuePrDesc'),
        icon: ic(<><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></>),
        insert: '/issue-pr '
      },
      ...skills
        .filter((s) => !['new', 'clear', 'model', 'theme', 'settings', 'export', 'plan', 'build', 'issue-pr'].includes(s.name.toLowerCase()))
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

  const mentionItems = useMemo<TriggerItem[]>(() => {
    const fileIcon = (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    )
    const folderIcon = (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    )
    const specials: TriggerItem[] = [
      {
        id: 'git',
        label: 'git',
        description: t('chat.mention.gitDesc'),
        hint: 'special',
        icon: fileIcon
      },
      {
        id: 'diff',
        label: 'diff',
        description: t('chat.mention.diffDesc'),
        hint: 'special',
        icon: fileIcon
      }
    ]
    const files = fileIndex.map((f) => ({
      id: f.rel + (f.isDirectory ? '/' : ''),
      label: f.name + (f.isDirectory ? '/' : ''),
      description: f.rel !== f.name ? f.rel : undefined,
      icon: f.isDirectory ? folderIcon : fileIcon
    }))
    return [...specials, ...files]
  }, [fileIndex, t])

  const loadFiles = async (): Promise<void> => {
    const roots = projectPaths.length ? projectPaths : effectivePath ? [effectivePath] : []
    if (!roots.length) return
    setFilesLoading(true)
    try {
      const merged: Array<{ name: string; path: string; rel: string; isDirectory: boolean }> = []
      for (const root of roots.slice(0, 4)) {
        const res = await window.api.fs.walk(root)
        if (!Array.isArray(res)) continue
        const base = root.endsWith('/') ? root : root + '/'
        const rootLabel = root.split('/').filter(Boolean).pop() || root
        for (const f of res) {
          const relInRoot = f.path.startsWith(base) ? f.path.slice(base.length) : f.name
          merged.push({
            name: f.name,
            path: f.path,
            // Prefix with root folder name when multi-root so @mentions stay unique.
            rel: roots.length > 1 ? `${rootLabel}/${relInRoot}` : relInRoot,
            isDirectory: Boolean(f.isDirectory)
          })
        }
      }
      setFileIndex(merged)
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

  const ensurePromptHistory = (sessionId: string): string[] => {
    let list = promptHistoryRef.current.get(sessionId)
    if (!list) {
      list = collectUserPrompts(messages)
      promptHistoryRef.current.set(sessionId, list)
    }
    return list
  }

  const handleSend = async (mode: 'queue' | 'steer' = defaultSendMode): Promise<void> => {
    if (!input.trim() && attachments.length === 0) return
    if (sendingRef.current) return
    sendingRef.current = true

    let projectId = activeProjectId
    let sessionId = activeSessionId
    const typedPrompt = input.trim()
    const sendAttachments = attachments
    // Clear composer immediately so a second Enter cannot re-send the same text
    // while we await @mention / git expansion.
    setInput('')
    setAttachments([])
    setTrigger(null)
    setHistoryIndex(-1)
    historyDraftRef.current = ''
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
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
      const title = typedPrompt.slice(0, 40) + (typedPrompt.length > 40 ? '...' : '')
      addSession(projectId, title)
      const store = useAppStore.getState()
      sessionId = store.activeSessionId || ''
      projectId = store.activeProjectId || projectId
    }

    if (!projectId || !sessionId) {
      // Session creation failed — put the draft back so the user can retry.
      setInput(typedPrompt)
      setAttachments(sendAttachments)
      return
    }

    // Resolve @mentions: specials (@git/@diff), folders, files (size-capped)
    const MENTION_FILE_CAP = 40_000
    const pathByRel = new Map(fileIndex.map((f) => [f.rel.replace(/\/$/, ''), f]))
    // also map with trailing slash for dirs
    for (const f of fileIndex) {
      if (f.isDirectory) pathByRel.set(f.rel.replace(/\/$/, '') + '/', f)
    }
    const tokens = [...new Set((typedPrompt.match(/@(\S+)/g) || []).map((tok) => tok.slice(1)))]
    const blocks: string[] = []
    const cwd = effectivePath || ''
    for (const raw of tokens) {
      const rel = raw.replace(/\/$/, '')
      if (rel === 'git' && cwd) {
        try {
          const [branch, status] = await Promise.all([
            window.api.shell.execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 10_000),
            window.api.shell.execFile('git', ['status', '--short', '--branch'], cwd, 10_000)
          ])
          blocks.push(
            `<git>\nbranch: ${(branch.stdout || '').trim()}\n${(status.stdout || '').trim() || '(clean)'}\n</git>`
          )
        } catch {
          blocks.push('<git>\n(git status unavailable)\n</git>')
        }
        continue
      }
      if (rel === 'diff' && cwd) {
        try {
          const d = await window.api.shell.execFile('git', ['diff', 'HEAD', '--no-color'], cwd, 20_000)
          const text = (d.stdout || '(no changes)').slice(0, 30_000)
          blocks.push(`<git_diff>\n${text}\n</git_diff>`)
        } catch {
          blocks.push('<git_diff>\n(git diff unavailable)\n</git_diff>')
        }
        continue
      }
      const entry = pathByRel.get(raw) || pathByRel.get(rel) || pathByRel.get(rel + '/')
      if (!entry) continue
      if (entry.isDirectory) {
        try {
          const listing = await window.api.fs.listDir(entry.path)
          if (Array.isArray(listing)) {
            const lines = listing
              .slice(0, 80)
              .map((e) => `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name}`)
              .join('\n')
            blocks.push(`<folder path="${entry.rel}">\n${lines || '(empty)'}\n</folder>`)
          }
        } catch {
          /* skip folder */
        }
        continue
      }
      try {
        const r = await window.api.fs.readFile(entry.path)
        if (typeof r === 'string') {
          const body =
            r.length > MENTION_FILE_CAP
              ? r.slice(0, MENTION_FILE_CAP) + `\n...(truncated ${r.length - MENTION_FILE_CAP} chars)`
              : r
          blocks.push(`<file path="${entry.rel}">\n${body}\n</file>`)
        }
      } catch {
        /* skip file */
      }
    }
    const skillByName = new Map(skills.map((s) => [s.name, s]))
    const slashTokens = [...new Set((typedPrompt.match(/\/([^\s/]+)/g) || []).map((tok) => tok.slice(1)))]
    for (const name of slashTokens) {
      const sk = skillByName.get(name)
      if (sk) blocks.push(`<skill name="${name}">\n${sk.content}\n</skill>`)
    }
    // /issue-pr #42 — inject Issue→PR playbook (SWE-agent style), prefetch when connected
    const issuePrMatch = typedPrompt.match(/(?:^|\s)\/issue-pr(?:\s+(\S+))?/i)
    if (issuePrMatch) {
      const arg = (issuePrMatch[1] || '').trim()
      const parsed = parseIssuePrArg(arg || typedPrompt.replace(/\/issue-pr/i, '').trim())
      if (parsed) {
        let prefetched: string | undefined
        try {
          prefetched = await prefetchIssueContext({
            issueRef: parsed.issueRef,
            repoHint: parsed.repoHint,
            projectPath: cwd || undefined
          })
        } catch {
          prefetched = undefined
        }
        blocks.push(buildIssuePrPlaybook({ ...parsed, prefetched }))
      }
      setAgentMode('build')
    }
    const finalContent = blocks.length ? blocks.join('\n\n') + '\n\n' + typedPrompt : typedPrompt

    // Remember the raw typed prompt (not expanded @mentions) for ↑/↓ recall.
    pushPromptHistory(ensurePromptHistory(sessionId), typedPrompt)

    sendMessage(projectId, sessionId, finalContent, mode, sendAttachments)
    } finally {
      sendingRef.current = false
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    setInput(value)
    // Editing while browsing history exits history mode (new draft).
    if (historyIndex !== -1) {
      setHistoryIndex(-1)
      historyDraftRef.current = ''
    }
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

    // Session prompt history: ↑ older / ↓ newer (shell-style), only when the caret
    // is on the first/last line so multi-line editing still moves normally.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && activeSessionId) {
      const ta = textareaRef.current
      const selStart = ta?.selectionStart ?? 0
      const selEnd = ta?.selectionEnd ?? selStart
      if (selStart === selEnd) {
        const onEdge =
          e.key === 'ArrowUp' ? isCaretOnFirstLine(input, selStart) : isCaretOnLastLine(input, selStart)
        if (onEdge) {
          const step = navigatePromptHistory(
            e.key === 'ArrowUp' ? 'up' : 'down',
            historyIndex,
            historyDraftRef.current,
            ensurePromptHistory(activeSessionId),
            input
          )
          if (step) {
            e.preventDefault()
            historyDraftRef.current = step.draft
            setHistoryIndex(step.index)
            setInput(step.value)
            setTrigger(null)
            pendingCursor.current = step.value.length
            return
          }
        }
      }
    }

    // Alt+P: toggle Plan/Build (OpenCode Tab-equivalent without fighting focus).
    if (e.key === 'p' && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      toggleAgentMode()
      return
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
  const sessionLoading =
    !!activeSessionId &&
    (loadingSessions.has(activeSessionId) || !loadedSessions.has(activeSessionId))

  return (
    <main
      className="chat-area"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="chat-drop-overlay">
          <div className="chat-drop-card">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="chat-drop-title">{t('chat.dropFilesTitle')}</span>
            <span className="chat-drop-desc">{t('chat.dropFilesDesc')}</span>
          </div>
        </div>
      )}
      <ChatHeader
        onToggleSidebar={onToggleSidebar}
        projectName={activeProject?.name}
        gitBranch={gitBranch}
        projectPath={effectivePath}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={onGoBack}
        onGoForward={onGoForward}
      />
      {projectPaths.length > 1 && (
        <div className="multi-root-bar" role="group" aria-label="Project roots">
          {projectPaths.map((p, i) => {
            const label = p.split('/').filter(Boolean).pop() || p
            return (
              <button
                key={p}
                type="button"
                className={`multi-root-chip ${i === rootIndex ? 'active' : ''}`}
                title={p}
                onClick={() => {
                  setRootIndex(i)
                  // Bind tool cwd for this session so agent loop uses the selected root.
                  if (activeSessionId && activeProjectId) {
                    useAppStore
                      .getState()
                      .updateSessionPath(activeProjectId, activeSessionId, p)
                  }
                }}
              >
                {i === 0 ? '★ ' : ''}
                {label}
              </button>
            )
          })}
        </div>
      )}
      <div className={sessionPaneClass} key={activeSessionId || 'none'}>
        {sessionLoading ? (
          <div className="chat-skeleton" aria-busy="true" aria-label="Loading messages">
            <div className="chat-skeleton-row user">
              <div className="chat-skeleton-line short" />
              <div className="chat-skeleton-bubble" />
            </div>
            <div className="chat-skeleton-row">
              <div className="chat-skeleton-line short" />
              <div className="chat-skeleton-line" />
              <div className="chat-skeleton-line" />
              <div className="chat-skeleton-line med" />
            </div>
            <div className="chat-skeleton-row user">
              <div className="chat-skeleton-line short" />
              <div className="chat-skeleton-bubble short" />
            </div>
            <div className="chat-skeleton-row">
              <div className="chat-skeleton-line short" />
              <div className="chat-skeleton-line" />
              <div className="chat-skeleton-line med" />
            </div>
          </div>
        ) : !activeSession || messages.length === 0 ? (
          <WelcomeScreen
            activeProject={activeProject}
            suggestions={suggestions}
            onPick={(text) => { setInput(text); setTrigger(null) }}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <MessageList
            messages={messages}
            isStreaming={sessionStreaming}
            endRef={messagesEndRef}
            startIndex={effectiveStart}
            nearTop={nearTop}
            onShowEarlier={() => setStartIndex(Math.max(0, effectiveStart - EARLIER_BATCH))}
            onScroll={handleMessageScroll}
            sessionKey={activeSessionId || ''}
            projectId={activeProjectId}
            sessionId={activeSessionId}
          />
        )}
      </div>
      <PlanStrip sessionId={activeSessionId} />
      <TurnReviewBar sessionId={activeSessionId} />
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
        isStreaming={sessionStreaming}
        onStop={() => {
          if (activeSessionId) stopStreaming(activeSessionId)
          else stopStreaming()
        }}
        attachments={attachments}
        onSteer={defaultSendMode === 'queue' ? () => { void handleSend('steer') } : undefined}
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
            if (activeProjectId && activeSessionId) {
              clearMessages(activeProjectId, activeSessionId)
              promptHistoryRef.current.delete(activeSessionId)
              setHistoryIndex(-1)
              historyDraftRef.current = ''
            }
            setShowClearConfirm(false)
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </main>
  )
}
