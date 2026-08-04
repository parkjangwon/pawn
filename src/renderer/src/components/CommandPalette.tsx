import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { useThemeStore } from '../stores/theme'
import { useKeybindingsStore, formatCombo } from '../stores/keybindings'
import './CommandPalette.css'

interface Command {
  id: string
  label: string
  description: string
  shortcut?: string
  action: () => void
  group: string
}

interface CommandPaletteProps {
  onClose: () => void
  onOpenSettings: () => void
}

export default function CommandPalette({ onClose, onOpenSettings }: CommandPaletteProps): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { projects, setActiveProject, addSession } = useAppStore()
  const { stopStreaming, isStreaming } = useChatStore()
  const { toggle: toggleTheme } = useThemeStore()
  const keybindings = useKeybindingsStore((s) => s.bindings)

  // Build commands list
  const commands: Command[] = [
    {
      id: 'new-session',
      label: t('commandPalette.commands.newSession'),
      description: t('commandPalette.commands.newSessionDesc'),
      shortcut: formatCombo(keybindings['new-session']),
      action: () => {
        const activeId = useAppStore.getState().activeProjectId
        if (activeId) addSession(activeId)
      },
      group: t('commandPalette.groups.actions')
    },
    {
      id: 'toggle-theme',
      label: t('commandPalette.commands.toggleTheme'),
      description: t('commandPalette.commands.toggleThemeDesc'),
      shortcut: '',
      action: () => toggleTheme(),
      group: 'actions'
    },
    {
      id: 'stop-streaming',
      label: t('commandPalette.commands.stopStreaming'),
      description: t('commandPalette.commands.stopStreamingDesc'),
      shortcut: '',
      action: () => stopStreaming(),
      group: 'actions'
    },
    {
      id: 'open-settings',
      label: t('commandPalette.commands.openSettings'),
      description: t('commandPalette.commands.openSettingsDesc'),
      shortcut: formatCombo(keybindings['open-settings']),
      action: () => { onOpenSettings(); onClose() },
      group: 'actions'
    },
    {
      id: 'toggle-right-panel',
      label: t('commandPalette.commands.toggleRightPanel'),
      description: t('commandPalette.commands.toggleRightPanelDesc'),
      shortcut: formatCombo(keybindings['toggle-right-panel']),
      action: () => { (window as any).__toggleRightPanel?.(); onClose() },
      group: 'actions'
    },
    {
      id: 'toggle-sidebar',
      label: t('commandPalette.commands.toggleSidebar'),
      description: t('commandPalette.commands.toggleSidebarDesc'),
      shortcut: formatCombo(keybindings['toggle-sidebar']),
      action: () => { (window as any).__toggleSidebar?.(); onClose() },
      group: 'actions'
    },
    ...projects.flatMap((p) => [
      {
        id: `switch-project-${p.id}`,
        label: `Switch to ${p.name}`,
        description: p.paths?.[0] || 'No path',
        shortcut: '',
        action: () => { setActiveProject(p.id); onClose() },
        group: 'projects'
      } as Command,
      ...p.sessions.map((s) => ({
        id: `switch-session-${s.id}`,
        label: s.title,
        description: `${p.name} - ${s.messages.length} msgs`,
        shortcut: '',
        action: () => { setActiveProject(p.id); useAppStore.getState().setActiveSession(s.id); onClose() },
        group: 'sessions'
      } as Command))
    ])
  ]

  const filtered = query.trim()
    ? commands.filter((c) => {
        const q = query.toLowerCase()
        return c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      })
    : commands

  const safeIndex = Math.min(selectedIndex, filtered.length - 1)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filtered[safeIndex]) {
      e.preventDefault()
      filtered[safeIndex].action()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[safeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex])

  // Group commands
  const grouped = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = []
    acc[cmd.group].push(cmd)
    return acc
  }, {})

  const groupOrder = ['actions', 'sessions', 'projects']

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cp-input-wrapper">
          <svg className="cp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cp-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.placeholder')}
          />
          {query && (
            <button className="cp-clear" onClick={() => setQuery('')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>

        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cp-empty">{t('commandPalette.noResults')}</div>
          )}
          {groupOrder.filter((g) => grouped[g]).map((group) => (
            <div key={group}>
              <div className="cp-group-label">{t(`commandPalette.groups.${group}`)}</div>
              {grouped[group].map((cmd, i) => {
                const idx = filtered.indexOf(cmd)
                return (
                  <div
                    key={cmd.id}
                    className={`cp-item ${idx === safeIndex ? 'selected' : ''}`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="cp-item-info">
                      <span className="cp-item-label">{cmd.label}</span>
                      <span className="cp-item-desc">{cmd.description}</span>
                    </div>
                    {cmd.shortcut && <span className="cp-item-shortcut">{cmd.shortcut}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> {t('commandPalette.navigate')}</span>
          <span><kbd>↵</kbd> {t('commandPalette.select')}</span>
          <span><kbd>Esc</kbd> {t('commandPalette.close')}</span>
        </div>
      </div>
    </div>
  )
}
