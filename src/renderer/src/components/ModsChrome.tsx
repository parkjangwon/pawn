import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { getModRuntime, listActiveModLine, reloadMods, useModsUiStore } from '../agent/mods'
import { modConflictLine, modEventLabel } from '../agent/mods/eventLabel'
import { useAppStore } from '../stores/app'
import { useFocusTrap } from '../utils/focusTrap'
import { openPluginsExtensions } from './settingsState'
import ModTree from './ModTree'
import './ModsChrome.css'

/**
 * Session chrome for mods:
 * chip + popover, compact status, notices, above-prompt tree, docked panes,
 * and toasts as a corner overlay (does not push the composer).
 */
export default function ModsChrome({
  onOpenSettings
}: {
  onOpenSettings?: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const statusByPlugin = useModsUiStore((s) => s.statusByPlugin)
  const toasts = useModsUiStore((s) => s.toasts)
  const notices = useModsUiStore((s) => s.notices)
  const panes = useModsUiStore((s) => s.panes)
  const abovePrompts = useModsUiStore((s) => s.abovePrompts)
  const renderGeneration = useModsUiStore((s) => s.renderGeneration)
  const runtimeGeneration = useModsUiStore((s) => s.runtimeGeneration)
  const timeline = useModsUiStore((s) => s.timeline)
  const clearTimeline = useModsUiStore((s) => s.clearTimeline)
  const closePane = useModsUiStore((s) => s.closePane)
  const dismissToast = useModsUiStore((s) => s.dismissToast)
  const dismissNotice = useModsUiStore((s) => s.dismissNotice)

  const [menuOpen, setMenuOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useFocusTrap(menuOpen, menuRef, { initialFocus: 'button' })

  const projectPath = useAppStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return p?.paths?.[0] || ''
  })
  const sessionId = useAppStore((s) => s.activeSessionId || '')

  useEffect(() => {
    return getModRuntime().subscribe(() => {
      /* runtimeGeneration already bumped */
    })
  }, [])

  useEffect(() => {
    void getModRuntime().emitUiRender('AbovePrompt', {}).catch(() => {})
  }, [renderGeneration, runtimeGeneration])

  const activeMods = useMemo(() => {
    void runtimeGeneration
    return getModRuntime().getActiveMods()
  }, [runtimeGeneration])

  const commands = useMemo(() => {
    void runtimeGeneration
    return getModRuntime().getCommands()
  }, [runtimeGeneration])

  const conflicts = useMemo(() => {
    void runtimeGeneration
    return getModRuntime().getConflicts()
  }, [runtimeGeneration])

  const activeLine = useMemo(() => {
    void runtimeGeneration
    return listActiveModLine()
  }, [runtimeGeneration])

  const statusEntries = useMemo(
    () => Object.entries(statusByPlugin).filter(([, text]) => text.trim().length > 0),
    [statusByPlugin]
  )

  const openSettings = useCallback((): void => {
    setMenuOpen(false)
    openPluginsExtensions()
    onOpenSettings?.()
  }, [onOpenSettings])

  const toggleMod = async (name: string, wantOn: boolean): Promise<void> => {
    const api = window.api?.mods
    if (!api) return
    const s = await api.settings().catch(() => null)
    if (!s) return
    const disabled = wantOn
      ? (s.disabledPlugins || []).filter((n) => n.toLowerCase() !== name.toLowerCase())
      : Array.from(new Set([...(s.disabledPlugins || []), name]))
    await api.setSettings({ disabledPlugins: disabled }).catch(() => null)
    await reloadMods({
      sessionId: sessionId || 'chrome',
      cwd: projectPath,
      projectPath: projectPath || null
    }).catch(() => [])
  }

  const moveMod = async (name: string, dir: -1 | 1): Promise<void> => {
    const api = window.api?.mods
    if (!api?.setSettings) return
    const order = getModRuntime().getLoaded().map((m) => m.name)
    const i = order.findIndex((n) => n.toLowerCase() === name.toLowerCase())
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    const [item] = next.splice(i, 1)
    next.splice(j, 0, item)
    await api.setSettings({ pluginOrder: next }).catch(() => null)
    await reloadMods({
      sessionId: sessionId || 'chrome',
      cwd: projectPath,
      projectPath: projectPath || null
    }).catch(() => [])
  }

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onDown = (e: MouseEvent): void => {
      const el = e.target as HTMLElement
      if (!el.closest('.mods-chrome-chip-wrap')) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menuOpen])

  const hasInline = Boolean(
    activeLine ||
      statusEntries.length ||
      notices.length ||
      abovePrompts.length ||
      panes.length ||
      timeline.length ||
      conflicts.length
  )
  const hasToasts = toasts.length > 0
  if (!hasInline && !hasToasts) return null

  const chipLabel =
    activeMods.length === 0
      ? ''
      : activeMods.length === 1
        ? t('chat.mods.chipOne', { name: activeMods[0].name })
        : t('chat.mods.chipMany', { count: activeMods.length })

  return (
    <>
      {hasInline && (
        <div className="mods-chrome" aria-live="polite">
          {chipLabel && (
            <div className="mods-chrome-chip-wrap">
              <button
                type="button"
                className="mods-chrome-chip"
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                onClick={() => setMenuOpen((v) => !v)}
                title={t('chat.mods.activeTitle')}
              >
                <span className="mods-chrome-dot" aria-hidden />
                <span>{chipLabel}</span>
              </button>
              {menuOpen && (
                <div
                  ref={menuRef}
                  className="mods-chrome-menu"
                  role="dialog"
                  aria-label={t('chat.mods.menuTitle')}
                >
                  <div className="mods-chrome-menu-head">{t('chat.mods.menuTitle')}</div>
                  <ul className="mods-chrome-menu-list">
                    {activeMods.map((mod) => (
                      <li key={mod.id} className="mods-chrome-menu-row">
                        <div className="mods-chrome-menu-info">
                          <strong>{mod.name}</strong>
                          <span>
                            {mod.description?.trim() ||
                              mod.hooks.slice(0, 3).map((hook) => modEventLabel(hook)).join(' · ') ||
                              mod.source}
                          </span>
                        </div>
                        <label className="mods-chrome-mini-toggle">
                          <input
                            type="checkbox"
                            checked={mod.enabled}
                            aria-label={t('chat.mods.toggleNamed', { name: mod.name })}
                            onChange={(e) => void toggleMod(mod.name, e.target.checked)}
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                  {conflicts.length > 0 && (
                    <div className="mods-chrome-menu-cmds">
                      <div className="mods-chrome-menu-head">{t('chat.mods.conflicts')}</div>
                      {conflicts.map((c) => (
                        <div key={c.event} className="mods-chrome-conflict-block">
                          <p className="mods-chrome-conflict-line">{modConflictLine(c.event, c.plugins)}</p>
                          <div className="mods-chrome-order">
                            {c.plugins.map((name) => (
                              <span key={name} className="mods-chrome-order-item">
                                <button
                                  type="button"
                                  aria-label={t('chat.mods.moveEarlier', { name })}
                                  onClick={() => void moveMod(name, -1)}
                                >
                                  {t('chat.mods.earlier')}
                                </button>
                                <span>{name}</span>
                                <button
                                  type="button"
                                  aria-label={t('chat.mods.moveLater', { name })}
                                  onClick={() => void moveMod(name, 1)}
                                >
                                  {t('chat.mods.later')}
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {commands.length > 0 && (
                    <div className="mods-chrome-menu-cmds">
                      <div className="mods-chrome-menu-head">{t('chat.mods.commands')}</div>
                      {commands.map((cmd) => (
                        <div key={`${cmd.plugin}:${cmd.name}`} className="mods-chrome-cmd">
                          <code>/{cmd.name}</code>
                          <span>{cmd.plugin}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" className="mods-chrome-menu-settings" onClick={openSettings}>
                    {t('chat.mods.openSettings')}
                  </button>
                </div>
              )}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="mods-chrome-conflicts" role="status">
              <span className="mods-chrome-origin">{t('chat.mods.conflicts')}</span>
              <span className="mods-chrome-status-preview">
                {modConflictLine(conflicts[0].event, conflicts[0].plugins)}
                {conflicts.length > 1 ? `  +${conflicts.length - 1}` : ''}
              </span>
            </div>
          )}

          {timeline.length > 0 && (
            <div className="mods-chrome-timeline">
              <button
                type="button"
                className="mods-chrome-status-toggle"
                aria-expanded={timelineOpen}
                onClick={() => setTimelineOpen((v) => !v)}
              >
                <span className="mods-chrome-origin">{t('chat.mods.timeline')}</span>
                <span className="mods-chrome-status-preview">
                  {timeline[timeline.length - 1]?.text}
                  {` · ${timeline.length}`}
                </span>
              </button>
              {timelineOpen && (
                <div className="mods-chrome-timeline-list">
                  {[...timeline].reverse().slice(0, 12).map((entry) => (
                    <div key={entry.id} className={`mods-chrome-timeline-row ${entry.kind}`}>
                      <span className="mods-chrome-origin">{entry.plugin}</span>
                      <span>{entry.text}</span>
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </time>
                    </div>
                  ))}
                  <button type="button" className="mods-chrome-menu-settings" onClick={() => clearTimeline()}>
                    {t('chat.mods.clearTimeline')}
                  </button>
                </div>
              )}
            </div>
          )}

          {statusEntries.length > 0 && (
            <div className="mods-chrome-status">
              <button
                type="button"
                className="mods-chrome-status-toggle"
                aria-expanded={statusOpen}
                onClick={() => setStatusOpen((v) => !v)}
              >
                <span className="mods-chrome-origin">{statusEntries[0][0]}</span>
                <span className="mods-chrome-status-preview">
                  {statusEntries[0][1]}
                  {statusEntries.length > 1 ? ` · +${statusEntries.length - 1}` : ''}
                </span>
              </button>
              {statusOpen &&
                statusEntries.slice(1).map(([plugin, text]) => (
                  <div key={plugin} className="mods-chrome-status-row">
                    <span className="mods-chrome-origin">{plugin}</span>
                    <span>{text}</span>
                  </div>
                ))}
            </div>
          )}

          {notices.map((n) => (
            <div key={n.id} className={`mods-chrome-notice ${n.kind}`} role="status">
              <span className="mods-chrome-origin">{n.plugin}</span>
              <span className="mods-chrome-notice-text">{n.text}</span>
              <button
                type="button"
                className="mods-chrome-dismiss"
                aria-label={t('common.close')}
                onClick={() => dismissNotice(n.id)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}

          {abovePrompts.map((band) => (
            <div
              key={band.plugin}
              className="mods-chrome-above"
              role="region"
              aria-label={t('chat.mods.abovePrompt')}
            >
              <ModTree tree={band.tree} plugin={band.plugin} surfaceId={`above-prompt-${band.plugin}`} />
            </div>
          ))}

          {panes.map((pane) => (
            <div key={pane.id} className="mods-chrome-pane" role="complementary" aria-label={pane.title}>
              <div className="mods-chrome-pane-head">
                <span className="mods-chrome-origin">{pane.plugin}</span>
                <strong>{pane.title}</strong>
                <button
                  type="button"
                  className="mods-chrome-dismiss"
                  aria-label={t('common.close')}
                  onClick={() => closePane(pane.id)}
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="mods-chrome-pane-body">
                {pane.tree != null ? (
                  <ModTree tree={pane.tree} plugin={pane.plugin} surfaceId={pane.id} />
                ) : (
                  <span className="mods-chrome-pane-empty">{t('chat.mods.paneEmpty', { plugin: pane.plugin })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasToasts &&
        createPortal(
          <div className="mods-chrome-toast-stack" aria-live="polite">
            {toasts.map((toast) => (
              <div key={toast.id} className="mods-chrome-toast" role="status">
                <span className="mods-chrome-origin">{toast.plugin}</span>
                <span>{toast.text}</span>
                <button
                  type="button"
                  className="mods-chrome-dismiss"
                  aria-label={t('common.close')}
                  onClick={() => dismissToast(toast.id)}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}
