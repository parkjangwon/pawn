import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock,
  Disc,
  Folder,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings,
  Square,
  Sun,
  Terminal,
  Users,
  X
} from 'lucide-react'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import { useChatStore } from '../stores/chat'
import { useRecordingStore } from '../stores/recording'
import { useThemeStore } from '../stores/theme'
import { useKeybindingsStore, formatCombo } from '../stores/keybindings'
import { useFocusTrap } from '../utils/focusTrap'
import { fuzzyMatchRanges, scoreFields } from '../utils/fuzzyMatch'
import { reloadMods } from '../agent/mods'
import { openPluginsExtensions, openSettingsSection } from './settingsState'
import { SECTIONS } from './settingsMeta'
import './CommandPalette.css'

type GroupId = 'recent' | 'actions' | 'navigation' | 'sessions' | 'projects' | 'settings'

interface Command {
  id: string
  label: string
  description: string
  shortcut?: string
  group: GroupId
  keywords?: string
  icon: React.ReactNode
  action: () => void
}

interface CommandPaletteProps {
  onClose: () => void
  onOpenSettings: () => void
  onMainViewChange?: (view: 'chat' | 'automations') => void
}

const GENERAL_ID = '__general__'
const GROUP_ORDER: GroupId[] = ['sessions', 'recent', 'actions', 'projects', 'navigation', 'settings']
const MAX_SESSIONS = 14
const MAX_PROJECTS = 20
const RECENT_KEY = 'pawn-cp-recent'
const MAX_RECENT = 4

/** Recently run palette actions (sessions/projects already sort by recency). */
export function readRecentCommands(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

export function recordRecentCommand(id: string): void {
  if (id.startsWith('session-') || id.startsWith('project-')) return
  try {
    const next = [id, ...readRecentCommands().filter((x) => x !== id)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
}

/** Label with fuzzy-matched characters wrapped in <mark>. */
function Icon({ d }: { d: React.ReactNode }): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  )
}

/** Label with fuzzy-matched characters wrapped in <mark>. */
function HighlightedText({ text, query }: { text: string; query: string }): React.JSX.Element {
  const ranges = query.trim() ? fuzzyMatchRanges(text, query) : []
  if (ranges.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start))
    parts.push(<mark key={i} className="cp-match">{text.slice(r.start, r.end)}</mark>)
    cursor = r.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

/**
 * Render shortcuts as kbd chips.
 * formatCombo on mac is often "⌘B" / "⌘," (no '+'); elsewhere "Ctrl+B".
 */
function ShortcutKeys({ combo }: { combo: string }): React.JSX.Element | null {
  if (!combo?.trim()) return null
  let parts: string[]
  if (combo.includes('+')) {
    parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  } else {
    // Split leading modifier glyphs from the key (⌘⌥⇧⌃)
    const m = combo.match(/^([⌘⌥⇧⌃]*)(.*)$/)
    if (m && (m[1] || m[2])) {
      parts = [...(m[1] || '').split('').filter(Boolean), m[2]].filter(Boolean)
    } else {
      parts = [combo]
    }
  }
  if (parts.length === 0) return null
  return (
    <span className="cp-shortcut" aria-hidden>
      {parts.map((p, i) => (
        <kbd key={`${p}-${i}`}>{p}</kbd>
      ))}
    </span>
  )
}

export default function CommandPalette({
  onClose,
  onOpenSettings,
  onMainViewChange
}: CommandPaletteProps): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  useFocusTrap(true, modalRef, { initialFocus: 'input, [data-cp-search]' })

  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const openNewChat = useAppStore((s) => s.openNewChat)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const setTheme = useThemeStore((s) => s.set)
  const keybindings = useKeybindingsStore((s) => s.bindings)
  const [recentIds] = useState<string[]>(() => readRecentCommands())
  const hasChat = useAppStore((s) => {
    const session = s.projects
      .find((p) => p.id === s.activeProjectId)
      ?.sessions.find((ss) => ss.id === s.activeSessionId)
    return Boolean(session && session.messages.length > 0)
  })

  const run = useCallback((fn: () => void) => {
    fn()
    onClose()
  }, [onClose])

  const commands = useMemo((): Command[] => {
    const realProjects = projects.filter((p) => p.id !== GENERAL_ID)
    const allSessions = projects
      .flatMap((p) => p.sessions.map((s) => ({
        session: s,
        projectId: p.id,
        projectName: p.id === GENERAL_ID ? t('contextBar.noProject') : p.name
      })))
      .sort((a, b) => b.session.createdAt - a.session.createdAt)

    const recentSessions = allSessions.slice(0, MAX_SESSIONS)
    const projectEntries = realProjects.slice(0, MAX_PROJECTS)

    const actions: Command[] = [
      {
        id: 'new-session',
        label: t('commandPalette.commands.newSession'),
        description: t('commandPalette.commands.newSessionDesc'),
        shortcut: formatCombo(keybindings['new-session']),
        group: 'actions',
        keywords: 'new chat session blank',
        icon: <Plus size={16} />,
        action: () => run(() => {
          onMainViewChange?.('chat')
          openNewChat()
        })
      },
      ...(hasChat
        ? [{
            id: 'find-in-chat',
            label: t('commandPalette.commands.findInChat'),
            description: t('commandPalette.commands.findInChatDesc'),
            shortcut: formatCombo('Meta+F'),
            group: 'actions' as GroupId,
            keywords: 'find search conversation text ctrl+f',
            icon: <Search size={16} />,
            action: () => run(() => {
              onMainViewChange?.('chat')
              // After the palette's focus-restore frame, or it steals focus back.
              window.setTimeout(() => window.dispatchEvent(new Event('pawn:open-find')), 80)
            })
          }]
        : []),
      ...(useRecordingStore.getState().supported
        ? [{
            id: 'record-workflow',
            label: useRecordingStore.getState().status.state === 'recording' ? t('record.button.stop') : t('record.palette.label'),
            description: t('record.palette.desc'),
            group: 'actions' as const,
            keywords: 'record replay skill demo macro workflow 녹화 스킬',
            icon: <Disc size={16} />,
            action: () => run(() => {
              const rec = useRecordingStore.getState()
              if (rec.status.state === 'recording') void rec.stop()
              else window.setTimeout(() => rec.openSetup(), 80)
            })
          }]
        : []),
      {
        id: 'open-automations',
        label: t('commandPalette.commands.openAutomations'),
        description: t('commandPalette.commands.openAutomationsDesc'),
        group: 'actions',
        keywords: 'automation routine schedule',
        icon: <Clock size={16} />,
        action: () => run(() => onMainViewChange?.('automations'))
      },
      {
        id: 'open-settings',
        label: t('commandPalette.commands.openSettings'),
        description: t('commandPalette.commands.openSettingsDesc'),
        shortcut: formatCombo(keybindings['open-settings']),
        group: 'actions',
        keywords: 'preferences config connections',
        icon: <Settings size={16} />,
        action: () => run(() => onOpenSettings())
      },
      {
        id: 'mods-reload',
        label: t('commandPalette.commands.modsReload'),
        description: t('commandPalette.commands.modsReloadDesc'),
        group: 'actions',
        keywords: 'mods extensions hooks reload plugin in-app',
        icon: <Icon d={<><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h6v3h-6v-3z" /></>} />,
        action: () =>
          run(() => {
            const project = projects.find((p) => p.id === activeProjectId)
            const cwd = getEffectiveProjectPath(project, activeSessionId) || ''
            void reloadMods({
              sessionId: activeSessionId || 'palette',
              cwd,
              projectPath: cwd || null
            }).catch(() => {})
          })
      },
      {
        id: 'mods-settings',
        label: t('commandPalette.commands.modsSettings'),
        description: t('commandPalette.commands.modsSettingsDesc'),
        group: 'actions',
        keywords: 'mods extensions settings plugins consent',
        icon: <Icon d={<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /></>} />,
        action: () =>
          run(() => {
            openPluginsExtensions()
            onOpenSettings()
          })
      },
      {
        id: 'keyboard-shortcuts',
        label: t('commandPalette.shortcuts'),
        description: t('commandPalette.shortcutsDesc'),
        group: 'actions',
        keywords: 'shortcuts keys keyboard help cheat',
        icon: <Icon d={<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>} />,
        action: () => run(() => { window.dispatchEvent(new CustomEvent('pawn:shortcuts-help')) })
      },
      {
        id: 'stop-streaming',
        label: t('commandPalette.commands.stopStreaming'),
        description: isStreaming
          ? t('commandPalette.commands.stopStreamingDesc')
          : t('commandPalette.commands.stopStreamingIdle'),
        group: 'actions',
        keywords: 'stop cancel abort',
        icon: <Square size={16} />,
        action: () => run(() => { if (isStreaming) stopStreaming(activeSessionId ?? undefined) })
      }
    ]

    const navigation: Command[] = [
      {
        id: 'toggle-sidebar',
        label: t('commandPalette.commands.toggleSidebar'),
        description: t('commandPalette.commands.toggleSidebarDesc'),
        shortcut: formatCombo(keybindings['toggle-sidebar']),
        group: 'navigation',
        icon: <PanelLeft size={16} />,
        action: () => run(() => { (window as unknown as { __toggleSidebar?: () => void }).__toggleSidebar?.() })
      },
      {
        id: 'toggle-right-panel',
        label: t('commandPalette.commands.toggleRightPanel'),
        description: t('commandPalette.commands.toggleRightPanelDesc'),
        shortcut: formatCombo(keybindings['toggle-right-panel']),
        group: 'navigation',
        icon: <PanelRight size={16} />,
        action: () => run(() => { (window as unknown as { __toggleRightPanel?: () => void }).__toggleRightPanel?.() })
      },
      {
        id: 'open-agents-panel',
        label: t('commandPalette.commands.openAgents'),
        description: t('commandPalette.commands.openAgentsDesc'),
        group: 'navigation',
        keywords: 'subagent parallel worker explore agents',
        icon: <Users size={16} />,
        action: () =>
          run(() => {
            try {
              window.__openRightPanelTab?.('agents')
            } catch {
              /* optional */
            }
          })
      },
      {
        id: 'toggle-terminal',
        label: t('commandPalette.commands.toggleTerminal'),
        description: t('commandPalette.commands.toggleTerminalDesc'),
        shortcut: formatCombo(keybindings['toggle-terminal']),
        group: 'navigation',
        icon: <Terminal size={16} />,
        action: () => run(() => { (window as unknown as { __toggleTerminal?: () => void }).__toggleTerminal?.() })
      },
      {
        id: 'theme-toggle',
        label: t('commandPalette.commands.toggleTheme'),
        description: t('commandPalette.commands.toggleThemeDesc', {
          current: theme === 'dark'
            ? t('commandPalette.themeDark')
            : theme === 'light'
              ? t('commandPalette.themeLight')
              : t('commandPalette.themeSystem')
        }),
        group: 'navigation',
        keywords: 'dark light appearance',
        icon: theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />,
        action: () => run(() => toggleTheme())
      },
      {
        id: 'theme-light',
        label: t('commandPalette.commands.themeLight'),
        description: t('commandPalette.commands.themeLightDesc'),
        group: 'navigation',
        keywords: 'light appearance',
        icon: <Sun size={16} />,
        action: () => run(() => setTheme('light'))
      },
      {
        id: 'theme-dark',
        label: t('commandPalette.commands.themeDark'),
        description: t('commandPalette.commands.themeDarkDesc'),
        group: 'navigation',
        keywords: 'dark appearance',
        icon: <Moon size={16} />,
        action: () => run(() => setTheme('dark'))
      }
    ]

    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    const modSymbol = isMac ? '⌘' : 'Alt+'

    const sessions: Command[] = recentSessions.map(({ session, projectId, projectName }, idx) => ({
      id: `session-${session.id}`,
      label: session.title || t('sidebar.session'),
      description:
        projectId === GENERAL_ID
          ? ''
          : projectName,
      shortcut: idx < 8 ? `${modSymbol}${idx + 1}` : undefined,
      group: 'sessions' as GroupId,
      keywords: `${session.title} ${projectName}`,
      icon: <MessageSquare size={16} />,
      action: () => run(() => {
        onMainViewChange?.('chat')
        setActiveProject(projectId)
        setActiveSession(session.id)
      })
    }))

    const projectCmds: Command[] = projectEntries.map((p) => ({
      id: `project-${p.id}`,
      label: p.name,
      description: getEffectiveProjectPath(p)
        ? t('commandPalette.projectPath', { path: getEffectiveProjectPath(p) })
        : t('commandPalette.projectNoPath'),
      group: 'projects' as GroupId,
      keywords: `${p.name} ${p.paths?.join(' ') || ''}`,
      icon: <Folder size={16} />,
      action: () => run(() => {
        onMainViewChange?.('chat')
        setActiveProject(p.id)
        const first = p.sessions[0]
        if (first) setActiveSession(first.id)
      })
    }))

    // Every settings section, deep-linked: fuzzy search jumps straight to the
    // pane instead of opening Settings and scrolling the nav.
    const settingsCmds: Command[] = SECTIONS.map((s) => ({
      id: `settings-${s.id}`,
      label: t(s.labelKey),
      description: t(s.groupKey),
      group: 'settings' as GroupId,
      keywords: s.searchKey ? t(s.searchKey) : '',
      icon: <Icon d={<path d={s.icon} />} />,
      action: () => run(() => {
        openSettingsSection(s.id)
        onOpenSettings()
      })
    }))

    return [...sessions, ...actions, ...projectCmds, ...navigation, ...settingsCmds]
  }, [
    projects, keybindings, t, run, onMainViewChange, onOpenSettings, openNewChat,
    stopStreaming, isStreaming, theme, toggleTheme, setTheme, setActiveProject, setActiveSession,
    hasChat
  ])

  // Empty query: recently run actions surface in their own group. With a
  // query: tiered fuzzy score (label > description > keywords), best first.
  const scored = useMemo((): Array<{ cmd: Command; score: number }> => {
    const q = query.trim()
    if (!q) {
      const recent = recentIds
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is Command => Boolean(c))
      const recentSet = new Set(recent.map((c) => c.id))
      return [
        ...recent.map((c, i) => ({ cmd: { ...c, group: 'recent' as GroupId }, score: i })),
        ...commands.filter((c) => !recentSet.has(c.id)).map((cmd, i) => ({ cmd, score: i }))
      ]
    }
    const out: Array<{ cmd: Command; score: number }> = []
    for (const cmd of commands) {
      const score = scoreFields(
        [
          { text: cmd.label, weight: 0 },
          { text: cmd.description, weight: 60 },
          { text: cmd.keywords, weight: 120 },
          { text: cmd.id, weight: 200 }
        ],
        q
      )
      if (score !== null) out.push({ cmd, score })
    }
    return out
  }, [commands, query, recentIds])

  const groups = useMemo(() => {
    const byGroup = GROUP_ORDER
      .map((g) => {
        const items = scored.filter((x) => x.cmd.group === g)
        if (query.trim()) items.sort((a, b) => a.score - b.score)
        return {
          id: g,
          best: items.length ? Math.min(...items.map((x) => x.score)) : Infinity,
          items: items.map((x) => x.cmd)
        }
      })
      .filter((g) => g.items.length > 0)
    // With a query the group holding the best match leads, so Enter picks it.
    if (query.trim()) byGroup.sort((a, b) => a.best - b.best)
    return byGroup
  }, [scored, query])

  const flatItems = useMemo(() => {
    return groups.flatMap((g) => g.items)
  }, [groups])

  const safeIndex = flatItems.length === 0 ? 0 : Math.min(Math.max(0, selectedIndex), flatItems.length - 1)

  const execute = useCallback((cmd: Command) => {
    recordRecentCommand(cmd.id)
    cmd.action()
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const el = itemRefs.current.get(safeIndex)
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [safeIndex])

  // Global capturing key listener to guarantee keyboard events always work
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      // Direct session jump with Cmd/Alt/Ctrl + Number (1-8)
      if ((e.metaKey || e.altKey || e.ctrlKey) && Number(e.key) >= 1 && Number(e.key) <= 8) {
        const targetIdx = Number(e.key) - 1
        const sessionCmds = groups.find((g) => g.id === 'sessions')?.items || []
        if (sessionCmds[targetIdx]) {
          e.preventDefault()
          e.stopPropagation()
          sessionCmds[targetIdx].action()
          return
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        if (flatItems.length === 0) return
        setSelectedIndex((i) => (i + 1) % flatItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        if (flatItems.length === 0) return
        setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (flatItems[safeIndex]) {
          execute(flatItems[safeIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Home') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex(flatItems.length - 1)
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((i) => Math.min(flatItems.length - 1, i + 5))
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((i) => Math.max(0, i - 5))
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true)
  }, [flatItems, safeIndex, groups, onClose, execute])

  let flatCursor = -1

  return (
    <div
      className="cp-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="cp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.title')}
        onClick={(e) => {
          e.stopPropagation()
          inputRef.current?.focus()
        }}
      >
        <div className="cp-header">
          <div className="cp-search-field">
            <span className="cp-search-icon" aria-hidden>
              <Search size={16} />
            </span>
            <input
              ref={inputRef}
              className="cp-input"
              data-cp-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('commandPalette.placeholder')}
              aria-autocomplete="list"
              aria-controls="cp-listbox"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button
                type="button"
                className="cp-clear"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label={t('commandPalette.clear')}
              >
                <X size={16} />
              </button>
            ) : (
              <span className="cp-esc-hint" title={t('commandPalette.close')}>
                <kbd>esc</kbd>
              </span>
            )}
          </div>
        </div>

        <div className="cp-list" ref={listRef} id="cp-listbox" role="listbox">
          {flatItems.length === 0 && (
            <div className="cp-empty">
              <div className="cp-empty-title">{t('commandPalette.noResults')}</div>
              <div className="cp-empty-hint">{t('commandPalette.noResultsHint')}</div>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.id} className="cp-group" role="group" aria-label={t(`commandPalette.groups.${group.id}`)}>
              <div className="cp-group-label">{t(`commandPalette.groups.${group.id}`)}</div>
              {group.items.map((cmd) => {
                flatCursor += 1
                const idx = flatCursor
                const selected = idx === safeIndex
                const isActiveSession = cmd.id === `session-${activeSessionId}`
                const isActiveProject = cmd.id === `project-${activeProjectId}`
                return (
                  <button
                    type="button"
                    key={cmd.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(idx, el)
                      else itemRefs.current.delete(idx)
                    }}
                    role="option"
                    aria-selected={selected}
                    className={`cp-item ${selected ? 'selected' : ''} ${isActiveSession || isActiveProject ? 'current' : ''}`}
                    onClick={() => execute(cmd)}
                    onMouseMove={() => {
                      if (selectedIndex !== idx) setSelectedIndex(idx)
                    }}
                  >
                    <span className="cp-item-icon">{cmd.icon}</span>
                    <span className="cp-item-info">
                      <span className="cp-item-label">
                        <span className="cp-item-label-text">
                          <HighlightedText text={cmd.label} query={query} />
                        </span>
                        {(isActiveSession || isActiveProject) && (
                          <span className="cp-badge">{t('commandPalette.current')}</span>
                        )}
                      </span>
                    </span>
                    {cmd.description ? (
                      <span className="cp-item-project-tag">{cmd.description}</span>
                    ) : null}
                    {cmd.shortcut ? <ShortcutKeys combo={cmd.shortcut} /> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cp-footer">
          <span className="cp-footer-hint">
            <kbd>↑</kbd><kbd>↓</kbd>
            <span>{t('commandPalette.navigate')}</span>
          </span>
          <span className="cp-footer-hint">
            <kbd>↵</kbd>
            <span>{t('commandPalette.select')}</span>
          </span>
          <span className="cp-footer-hint">
            <kbd>Esc</kbd>
            <span>{t('commandPalette.close')}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
