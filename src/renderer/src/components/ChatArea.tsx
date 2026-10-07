import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  CirclePlus,
  ClipboardCheck,
  Crosshair,
  Disc,
  Download,
  FileText,
  Folder,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Zap
} from 'lucide-react'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useStreamingStore } from '../stores/streaming'
import type { TriggerItem } from './TriggerMenu'
import ProjectEditDialog from './ProjectEditDialog'
import { loadProjectContext, skillSummary, type LoadedSkill } from '../agent/skills'
import ChatHeader from './ChatHeader'
import WelcomeScreen from './WelcomeScreen'
import MessageList from './MessageList'
import { MarkdownBaseDirContext } from './LocalFileLinks'
import { gambitTrigger, matchGambits } from '../agent/gambits'
import { generalWorkspaceDir, generalWorkspaceDirSync } from '../utils/generalWorkspace'
import Composer from './Composer'
import { openSettingsSection } from './settingsState'
import PlanStrip from './PlanStrip'
import TurnReviewBar from './TurnReviewBar'
import ConfirmDialog from './ConfirmDialog'
import ChatFindBar from './ChatFindBar'
import TurnNavigator from './TurnNavigator'
import SelectionActions from './SelectionActions'
import QuestionCard from './QuestionCard'
import UltraWorkBanner from './UltraWorkBanner'
import RecordingBar from './RecordingBar'
import { useRecordingStore } from '../stores/recording'
import { parseUltraWork } from '../agent/ultraWork'
import { useUltraWorkStore } from '../stores/ultraWork'
import { appendQuoteToDraft, formatQuote } from '../utils/turnNavigator'
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
import { ensureModsLoaded, getModRuntime } from '../agent/mods'
import ModsChrome from './ModsChrome'
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
/** Show "jump to latest" once the reader is this far above the tail. */
const JUMP_LATEST_THRESHOLD_PX = 320

function isMacPlatform(): boolean {
  const plat = window.api?.platform
  if (plat && plat !== 'browser') return plat === 'darwin'
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '')
}

/** Scroll `el` to the top of `scroller` (with a small inset) without touching ancestors. */
function scrollIntoScroller(scroller: HTMLElement, el: Element, behavior: ScrollBehavior): void {
  const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
  if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ top: delta, behavior })
  else scroller.scrollTop += delta
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}

export default function ChatArea({
  onToggleSidebar, onOpenSettings, canGoBack, canGoForward, onGoBack, onGoForward
}: ChatAreaProps): React.JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showPermPicker, setShowPermPicker] = useState(false)
  const { projects, activeProjectId, activeSessionId, setActiveProject, addProject, addSession, removeSession, openNewChat, ensureGeneralProject, clearMessages, updateProjectName, loadedSessions, loadingSessions } = useAppStore()
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
  const [trigger, setTrigger] = useState<{ type: '/' | '@' | '$'; start: number; query: string } | null>(null)
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
  /** `.chat-messages` element — shared by find, turn navigator, selection menu. */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findNonce, setFindNonce] = useState(0)
  const [findSeed, setFindSeed] = useState('')
  const findOpenRef = useRef(false)
  findOpenRef.current = findOpen
  const [showJumpLatest, setShowJumpLatest] = useState(false)
  const [pendingJump, setPendingJump] = useState<{ id: string; nonce: number } | null>(null)
  const handledJumpRef = useRef(0)
  const jumpTimersRef = useRef<number[]>([])
  /** Programmatic jumps into earlier history must not snap back to the tail
   *  when scroll anchoring fires a scroll event near the bottom. */
  const holdWindowUntilRef = useRef(0)

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
  // Chats without a project folder work in the General workspace (chatLoop);
  // relative file links in their answers resolve against it too.
  const [generalDir, setGeneralDir] = useState<string | null>(generalWorkspaceDirSync())
  useEffect(() => {
    if (effectivePath || generalDir) return
    void generalWorkspaceDir().then(setGeneralDir).catch(() => {})
  }, [effectivePath, generalDir])
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
    setFindOpen(false)
    setShowJumpLatest(false)
    setPendingJump(null)
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
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance < 80
    stickToBottomRef.current = nearBottom
    setNearTop(el.scrollTop < 40)
    setShowJumpLatest(distance > JUMP_LATEST_THRESHOLD_PX)
    // Reached the bottom: drop the earlier-messages window and follow the tail.
    // Not while find is open — it may have loaded earlier messages to search.
    if (
      nearBottom &&
      startIndex !== null &&
      !findOpenRef.current &&
      Date.now() > holdWindowUntilRef.current
    ) {
      setStartIndex(null)
    }
  }

  const jumpToLatest = useCallback((): void => {
    stickToBottomRef.current = true
    setShowJumpLatest(false)
    setStartIndex(null)
    messagesEndRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  /** Turn navigator: scroll to a prompt, mounting earlier history if needed. */
  const jumpToMessage = useCallback((messageId: string): void => {
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    stickToBottomRef.current = false
    holdWindowUntilRef.current = Date.now() + 1500
    if (idx < effectiveStart) setStartIndex(idx)
    setPendingJump((prev) => ({ id: messageId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [messages, effectiveStart])

  useEffect(() => {
    if (!pendingJump || !scrollEl || handledJumpRef.current === pendingJump.nonce) return
    handledJumpRef.current = pendingJump.nonce
    const id = pendingJump.id
    const target = scrollEl.querySelector(
      `[data-message-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
    )
    if (!target) return
    for (const timer of jumpTimersRef.current) window.clearTimeout(timer)
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    scrollIntoScroller(scrollEl, target, behavior)
    // Messages above may still be at their estimated (content-visibility)
    // height; correct once layout has settled.
    const settle = window.setTimeout(() => {
      const off = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - 16
      if (Math.abs(off) > 24) scrollIntoScroller(scrollEl, target, 'auto')
    }, 420)
    target.classList.remove('message-flash')
    void (target as HTMLElement).offsetWidth
    target.classList.add('message-flash')
    const unflash = window.setTimeout(() => target.classList.remove('message-flash'), 1400)
    jumpTimersRef.current = [settle, unflash]
  }, [pendingJump, scrollEl])

  useEffect(() => () => {
    for (const timer of jumpTimersRef.current) window.clearTimeout(timer)
  }, [])

  const openFind = useCallback((seed?: string): void => {
    setFindSeed(seed ?? '')
    setFindOpen(true)
    setFindNonce((n) => n + 1)
  }, [])

  // "New chat" (sidebar / ⌘N / palette) → cursor in the composer.
  useEffect(() => {
    const onFocus = (): void => { requestAnimationFrame(() => textareaRef.current?.focus()) }
    window.addEventListener('pawn:focus-composer', onFocus)
    return () => window.removeEventListener('pawn:focus-composer', onFocus)
  }, [])

  // Skill cards (Record & Replay): put a prompt in the composer for review.
  useEffect(() => {
    const onPrefill = (e: Event): void => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (typeof text !== 'string' || !text) return
      setInput(text)
      setTrigger(null)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()
        try {
          ta.setSelectionRange(text.length, text.length)
        } catch {
          /* ignore */
        }
      })
    }
    window.addEventListener('pawn:composer-prefill', onPrefill)
    return () => window.removeEventListener('pawn:composer-prefill', onPrefill)
  }, [])

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    setFindSeed('')
    // Hand focus back to the composer, the most likely next action.
    textareaRef.current?.focus()
  }, [])

  const insertQuote = useCallback((text: string): void => {
    const quote = formatQuote(text)
    if (!quote) return
    let next = ''
    setInput((prev) => {
      next = appendQuoteToDraft(prev, quote)
      return next
    })
    setTrigger(null)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      const end = next.length || ta.value.length
      try {
        ta.setSelectionRange(end, end)
      } catch {
        /* ignore */
      }
    })
  }, [])

  // Cmd+F (macOS) / Ctrl+F: find in this conversation. Panels with their own
  // text surfaces (editor, terminal, settings, palette) keep the key.
  const hasMessages = !!activeSession && messages.length > 0
  useEffect(() => {
    if (!hasMessages) return
    const mac = isMacPlatform()
    const onKey = (e: KeyboardEvent): void => {
      const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!mod || e.altKey || e.shiftKey || e.isComposing) return
      if (e.key.toLowerCase() !== 'f' && e.code !== 'KeyF') return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('.right-panel, .bottom-terminal, .settings-page, .cp-overlay')) return
      if (document.querySelector('.settings-page, .cp-overlay, [role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      const sel = window.getSelection?.()?.toString().trim() || ''
      openFind(sel && sel.length <= 80 && !sel.includes('\n') ? sel : undefined)
    }
    const onOpenFind = (): void => openFind()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pawn:open-find', onOpenFind)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pawn:open-find', onOpenFind)
    }
  }, [hasMessages, openFind])

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
                  detail: { kind: 'info', message: t('chat.exportedTo', { path: r.path }) }
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
   if (projectId === '__general__') ensureGeneralProject()
   // Moving an untouched chat to another project: drop the empty session so
   // the first message starts a chat in the chosen project.
   if (activeSession && activeProjectId && activeProjectId !== projectId && loadedSessions.has(activeSession.id) && activeSession.messages.length === 0) {
     removeSession(activeProjectId, activeSession.id)
   }
   setActiveProject(projectId)
   setShowProjectPicker(false)
 }

  // --- Slash (/) commands and @ file mentions ---
  const buildSlash = (): TriggerItem[] => {
    const ic = (d: React.ReactNode): React.ReactNode => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
    )
    const builtinGroup = t('chat.slash.groupBuiltin')
    const modsGroup = t('chat.slash.groupMods')
    const skillsGroup = t('chat.slash.groupSkills')
    return [
      {
        id: 'new', label: t('chat.slash.new'), description: t('chat.slash.newDesc'),
        group: builtinGroup,
        icon: <Plus size={15} />,
        action: () => {
          // Same as sidebar "New chat": blank chat in the project on screen.
          openNewChat()
        }
      },
      {
        id: 'clear', label: t('chat.slash.clear'), description: t('chat.slash.clearDesc'),
        group: builtinGroup,
        icon: <Trash2 size={15} />,
        action: () => { if (activeProjectId && activeSessionId) setShowClearConfirm(true) }
      },
      {
        id: 'model', label: t('chat.slash.model'), description: t('chat.slash.modelDesc'),
        group: builtinGroup,
        icon: <Crosshair size={15} />,
        action: () => { setShowModelPicker(true); setShowPermPicker(false) }
      },
      {
        id: 'theme', label: t('chat.slash.theme'), description: t('chat.slash.themeDesc'),
        group: builtinGroup,
        icon: <Sun size={15} />,
        action: () => toggleTheme()
      },
      {
        id: 'settings', label: t('chat.slash.settings'), description: t('chat.slash.settingsDesc'),
        group: builtinGroup,
        icon: <Settings size={15} />,
        action: () => onOpenSettings()
      },
      {
        id: 'export', label: t('chat.slash.export'), description: t('chat.slash.exportDesc'),
        group: builtinGroup,
        icon: <Download size={15} />,
        action: () => handleExport()
      },
      {
        id: 'plan', label: t('chat.slash.plan'), description: t('chat.slash.planDesc'),
        group: builtinGroup,
        icon: <ClipboardCheck size={15} />,
        action: () => setAgentMode('plan', activeSessionId)
      },
      {
        id: 'build', label: t('chat.slash.build'), description: t('chat.slash.buildDesc'),
        group: builtinGroup,
        icon: <ArrowUp size={15} />,
        action: () => setAgentMode('build', activeSessionId)
      },
      {
        id: 'ultra-work',
        label: t('ultraWork.slashLabel'),
        description: t('ultraWork.slashDesc'),
        group: builtinGroup,
        hint: '$ulw',
        icon: <Zap size={15} />,
        insert: '/ultra-work '
      },
      ...(useRecordingStore.getState().supported
        ? [
            {
              id: 'record',
              label: t('record.slash.label'),
              description: t('record.slash.desc'),
              group: builtinGroup,
              icon: <Disc size={15} />,
              action: () => useRecordingStore.getState().openSetup({ projectId: activeProjectId ?? undefined, sessionId: activeSessionId ?? undefined })
            }
          ]
        : []),
      {
        id: 'issue-pr',
        label: t('chat.slash.issuePr'),
        description: t('chat.slash.issuePrDesc'),
        group: builtinGroup,
        icon: <CirclePlus size={15} />,
        insert: '/issue-pr '
      },
      ...getModRuntime().getCommands().map((cmd) => ({
        id: `mod-cmd:${cmd.plugin}:${cmd.name}`,
        label: cmd.name,
        description: cmd.description || t('settings.modsSection.commandHint'),
        group: modsGroup,
        hint: cmd.argumentHint || cmd.plugin,
        insert: `/${cmd.name} `,
        icon: ic(<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /></>)
      })),
      ...skills
        .filter((s) => !['new', 'clear', 'model', 'theme', 'settings', 'export', 'plan', 'build', 'issue-pr', 'ultra-work', 'ulw', 'record'].includes(s.name.toLowerCase()))
        .map((s) => {
        // Front-matter description first (SKILL.md), else the first prose line.
        const firstLine = (skillSummary(s) || s.content.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('---') && !l.startsWith('#')) || s.source.split('/').pop() || '').slice(0, 60)
        return {
          id: `skill:${s.name}`,
          label: s.name,
          description: firstLine,
          group: skillsGroup,
          hint: s.kind === 'command' || s.kind === 'plugin' || s.kind === 'agent' ? s.kind : 'skill',
          insert: `/${s.name} `,
          icon: <Sparkles size={15} />
        }
      })
    ]
  }

  const mentionItems = useMemo<TriggerItem[]>(() => {
    const fileIcon = (<FileText size={15} />)
    const folderIcon = (<Folder size={15} />)
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

  const gambitIcon = (<Zap size={15} />)
  const gambitItems = (query: string): TriggerItem[] =>
    matchGambits(query).map((g) => ({
      id: `gambit:${g.keyword}`,
      label: `$${g.keyword}${g.argKey ? ` ${t(g.argKey)}` : ''}`,
      description: `${t(g.labelKey)} · ${t(g.descKey)}`,
      hint: g.aliases.map((a) => `$${a}`).join(' ') || undefined,
      icon: gambitIcon,
      insert: `$${g.keyword} `
    }))

  const getItems = (): TriggerItem[] => {
    if (!trigger) return []
    if (trigger.type === '$') return gambitItems(trigger.query)
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
    const load = (): void => {
      loadProjectContext(effectivePath || undefined).then((c) => setSkills(filterEnabledSkills(c.skills))).catch(() => setSkills([]))
    }
    load()
    // A skill was saved (Record & Replay, save_skill): refresh the / list.
    window.addEventListener('pawn:skills-changed', load)
    return () => window.removeEventListener('pawn:skills-changed', load)
  }, [effectivePath])

  function handleSelect(item: TriggerItem): void {
    if (!trigger) return
    const value = input
    const cursor = textareaRef.current?.selectionStart ?? value.length
    if (trigger.type === '/' || trigger.type === '$') {
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
    // Mod slash commands run in-process with no model, so they pass even
    // before any provider is configured. Mods load lazily, so a cold chat
    // must load them before the command list can answer.
    let typedIsModCommand = false
    if (input.trim().startsWith('/')) {
      const cwdForMods =
        (activeProjectId && projects.find((p) => p.id === activeProjectId)?.paths?.[0]) || ''
      await ensureModsLoaded({
        sessionId: activeSessionId || 'pending',
        cwd: cwdForMods,
        projectPath: cwdForMods || null
      }).catch(() => [])
      const m = input.trim().match(/^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/)
      typedIsModCommand = !!m && getModRuntime().getCommands().some((c) => c.name === m[1])
    }
    // Block the send (and keep the composed text) when nothing can answer it —
    // the composer chip and this gate route the user straight to Providers.
    if (providers.filter((p) => p.enabled).length === 0 && !typedIsModCommand) {
      openSettingsSection('providers')
      return
    }
    sendingRef.current = true

    let projectId = activeProjectId
    // Never send into a session of another project (stale selection).
    let sessionId = activeSession ? activeSessionId : null
    const ultra = parseUltraWork(input)
    if (ultra && !ultra.goal) {
      // "$ulw" alone: nothing to pursue yet.
      sendingRef.current = false
      window.dispatchEvent(new CustomEvent('pawn:toast', { detail: { message: t('ultraWork.needGoal') } }))
      return
    }
    const typedPrompt = ultra ? ultra.goal : input.trim()
    const sendAttachments = attachments

    // Mod slash commands (`/tally`, …) — handled in-process, no Claude turn.
    const modCmdMatch = typedPrompt.match(/^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/)
    if (modCmdMatch && !ultra) {
      const cmdName = modCmdMatch[1]
      const cmdArgs = (modCmdMatch[2] || '').trim()
      const cwdForMods =
        (activeProjectId && projects.find((p) => p.id === activeProjectId)?.paths?.[0]) || ''
      await ensureModsLoaded({
        sessionId: activeSessionId || 'pending',
        cwd: cwdForMods,
        projectPath: cwdForMods || null
      }).catch(() => [])
      const runtime = getModRuntime()
      if (runtime.getCommands().some((c) => c.name === cmdName)) {
        setInput('')
        setAttachments([])
        setTrigger(null)
        setHistoryIndex(-1)
        historyDraftRef.current = ''
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        try {
          const answer = await runtime.emitCommandRun(cmdName, cmdArgs)
          const plugin = runtime.getCommands().find((c) => c.name === cmdName)?.plugin || 'mod'
          const text = (answer.text || '').trim()
          if (text && activeProjectId && activeSessionId) {
            useAppStore.getState().addMessage(activeProjectId, activeSessionId, {
              id: `mod-${Date.now()}`,
              role: 'assistant',
              content: text,
              createdAt: Date.now(),
              modelLabel: plugin
            })
          } else if (text) {
            window.dispatchEvent(new CustomEvent('pawn:toast', { detail: { message: t('chat.mods.commandToast', { plugin, text }) } }))
          }
        } catch (err) {
          window.dispatchEvent(
            new CustomEvent('pawn:toast', {
              detail: { message: err instanceof Error ? err.message : String(err) }
            })
          )
        } finally {
          sendingRef.current = false
        }
        return
      }
    }

    // Clear composer immediately so a second Enter cannot re-send the same text
    // while we await @mention / git expansion.
    setInput('')
    setAttachments([])
    setTrigger(null)
    setHistoryIndex(-1)
    historyDraftRef.current = ''
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
    // A project is selected but has no session yet: the chat belongs to it
    // (the welcome screen says "What should we build in <project>?").
    if (projectId && !sessionId && projects.some((p) => p.id === projectId)) {
      const title = typedPrompt.slice(0, 40) + (typedPrompt.length > 40 ? '...' : '')
      sessionId = addSession(projectId, title)
    }
    // No project at all: a General chat.
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
    pushPromptHistory(ensurePromptHistory(sessionId), ultra ? input.trim() : typedPrompt)

    if (ultra) {
      // Ultra Work: Build mode + MAXING until the goal is verified done.
      setAgentMode('build', sessionId)
      useUltraWorkStore.getState().start(sessionId, ultra.goal, ultra.maxIterations)
    }
    sendMessage(projectId, sessionId, finalContent, ultra ? 'steer' : mode, sendAttachments)
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
    // `$keyword` opening the message → Gambits menu (only when something matches,
    // so "$5" or "$HOME" never pops a menu).
    const gambit = gambitTrigger(before)
    if (gambit && matchGambits(gambit.query).length > 0) {
      setTrigger({ type: '$', ...gambit })
      setMenuIndex(0)
      return
    }
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

  const triggerItems = getItems()
  const triggerOpen = trigger !== null
  const sessionLoading =
    !!activeSessionId &&
    (loadingSessions.has(activeSessionId) || !loadedSessions.has(activeSessionId))

  const isHome = !sessionLoading && (!activeSession || messages.length === 0)
  const composerEl = (
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
  )

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
<Upload size={32} />
            <span className="chat-drop-title">{t('chat.dropFilesTitle')}</span>
            <span className="chat-drop-desc">{t('chat.dropFilesDesc')}</span>
          </div>
        </div>
      )}
      <ChatHeader
        onToggleSidebar={onToggleSidebar}
        projectName={activeProject && activeProject.id !== '__general__' ? activeProject.name : undefined}
        gitBranch={gitBranch}
        projectPath={effectivePath}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={onGoBack}
        onGoForward={onGoForward}
      />
      {projectPaths.length > 1 && (
        <div className="multi-root-bar" role="group" aria-label={t('chat.projectRoots')}>
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
          <div className="chat-skeleton" aria-busy="true" aria-label={t('chat.loadingMessages')}>
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
            // General is "no project" to the user: generic welcome, and it
            // doesn't tick "Open or create a project folder".
            activeProject={activeProject?.id === '__general__' ? undefined : activeProject}
            onPick={(text) => { setInput(text); setTrigger(null) }}
            composer={composerEl}
          />
        ) : (
          <>
            <MarkdownBaseDirContext.Provider value={effectivePath || generalDir}>
              <MessageList
                messages={messages}
                isStreaming={sessionStreaming}
                endRef={messagesEndRef}
                startIndex={effectiveStart}
                nearTop={nearTop}
                onShowEarlier={() => setStartIndex(Math.max(0, effectiveStart - EARLIER_BATCH))}
                onScroll={handleMessageScroll}
                scrollRef={setScrollEl}
                sessionKey={activeSessionId || ''}
                projectId={activeProjectId}
                sessionId={activeSessionId}
              />
            </MarkdownBaseDirContext.Provider>
            <TurnNavigator
              messages={messages}
              scrollEl={scrollEl}
              busy={sessionStreaming}
              onJump={jumpToMessage}
            />
            {findOpen && (
              <ChatFindBar
                scrollEl={scrollEl}
                focusNonce={findNonce}
                initialQuery={findSeed}
                messages={messages}
                startIndex={effectiveStart}
                onLoadEarlier={() => {
                  holdWindowUntilRef.current = Date.now() + 1500
                  setStartIndex(0)
                }}
                onClose={closeFind}
              />
            )}
            <SelectionActions scrollEl={scrollEl} onQuote={insertQuote} onFind={openFind} />
            {showJumpLatest && (
              <button
                type="button"
                className={`jump-latest${sessionStreaming ? ' live' : ''}`}
                onClick={jumpToLatest}
                aria-label={t('chat.jumpToLatest')}
                title={t('chat.jumpToLatest')}
              >
<ArrowDown size={14} aria-hidden />
                <span>{t('chat.jumpToLatest')}</span>
              </button>
            )}
          </>
        )}
      </div>
      <RecordingBar sessionId={activeSessionId} />
      <UltraWorkBanner sessionId={activeSessionId} />
      <PlanStrip sessionId={activeSessionId} />
      <ModsChrome onOpenSettings={onOpenSettings} />
      <div className="question-card-slot">
        <QuestionCard sessionId={activeSessionId} />
      </div>
      <TurnReviewBar sessionId={activeSessionId} />
      {/* On the home screen the composer lives inside WelcomeScreen (under the
          greeting); everywhere else it stays docked at the bottom. */}
      {isHome ? null : composerEl}
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
