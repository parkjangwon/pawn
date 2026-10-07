import NavControls from './NavControls'
import ConfirmDialog from './ConfirmDialog'
import AppearanceSettingsPanel from './AppearanceSettingsPanel'
import ProvidersSettingsPanel from './ProvidersSettingsPanel'
import ModelsSettingsPanel from './ModelsSettingsPanel'
import DecisionModelsSettingsPanel from './DecisionModelsSettingsPanel'
import AgentSettingsPanel from './AgentSettingsPanel'
import WikiPanel from './WikiPanel'
import HooksSettingsPanel from './HooksSettingsPanel'
import AgentsSettingsPanel from './AgentsSettingsPanel'
import UsageSettingsPanel from './UsageSettingsPanel'
import PluginsSettingsPanel from './PluginsSettingsPanel'
import SkillStorePanel from './SkillStorePanel'
import TelegramSettingsPanel from './TelegramSettingsPanel'
import RemoteSettingsPanel from './RemoteSettingsPanel'
import McpSettingsPanel from './McpSettingsPanel'
import ConnectionsSettingsPanel from './ConnectionsSettingsPanel'
import SystemSettingsPanel from './SystemSettingsPanel'
import ShortcutsSettingsPanel from './ShortcutsSettingsPanel'
import DataSettingsPanel from './DataSettingsPanel'
import { SECTIONS, type SettingsProps } from './settingsMeta'
import { useSettingsState } from './settingsState'
import { formatCombo } from '../stores/keybindings'
import Tooltip from './Tooltip'
import './Settings.css'
import { tx } from '../i18n'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useFocusTrap } from '../utils/focusTrap'
import { PanelLeft, Search } from 'lucide-react'

export default function Settings({
  onSidebarWidthChange,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onEscape
}: SettingsProps): React.JSX.Element {
  const state = useSettingsState({ onSidebarWidthChange })
  const [searchQuery, setSearchQuery] = useState('')
  const {
    navOpen,
    setNavOpen,
    groups,
    activeSection,
    setActiveSection,
    attachResizer,
    sessionBudgetUsd,
    setSessionBudgetUsd,
    dailyBudgetUsd,
    setDailyBudgetUsd,
    confirmDelete,
    setConfirmDelete,
    handleConfirmDelete,
    keybindings
  } = state

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase().trim()
    return SECTIONS.filter((s) => {
      const extra = s.searchKey ? tx(s.searchKey) : ''
      return `${tx(s.labelKey)} ${s.id} ${extra}`.toLowerCase().includes(q)
    })
  }, [searchQuery])

  const sidebarShortcut = formatCombo(keybindings['toggle-sidebar'])

  // Settings is a full-screen overlay dialog: trap Tab inside, restore focus
  // on unmount, and close on Escape — unless focus lives in a nested dialog
  // (FileBrowser, ConfirmDialog), which owns its own Escape.
  const pageRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(true, pageRef, { autoFocus: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const root = pageRef.current
      if (!root) return
      if (document.activeElement instanceof Element) {
        const nested = document.activeElement.closest('[role="dialog"], [aria-modal="true"]')
        if (nested && nested !== root) return
      }
      e.preventDefault()
      onEscape?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onEscape])

  return (
    <div
      ref={pageRef}
      role="dialog"
      aria-modal="true"
      aria-label={'Settings'}
      className={`settings-page ${navOpen ? '' : 'nav-collapsed'}`}
    >
      <div className="settings-header">
        <div className="settings-header-left">
          <Tooltip label={'Toggle settings sidebar'} shortcut={sidebarShortcut} placement="bottom">
            <button
              className="settings-header-back"
              onClick={() => setNavOpen((v) => !v)}
              aria-label={'Toggle settings sidebar'}
            >
              <PanelLeft size={18} />
            </button>
          </Tooltip>
          <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
        </div>
      </div>
      <div className="settings-sidebar">
        <div className="sidebar-top-row">
          <span className="sidebar-logo">Pawn</span>
        </div>
        <div className="sidebar-search">
          <div className="sidebar-search-box">
            <Search size={13} aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={'Search settings…'}
              aria-label={'Search settings…'}
            />
            {searchQuery && (
              <button
                type="button"
                className="sidebar-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label={'Clear'}
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="sidebar-scroll settings-nav-scroll">
          <div className="settings-nav">
          {filteredSections ? (
            <div className="sidebar-section">
              <div className="section-label">
                {'Search results'} ({filteredSections.length})
              </div>
              {filteredSections.map((section) => (
                <button
                  key={section.id}
                  className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={section.icon} />
                  </svg>
                  <span>{tx(section.labelKey)}</span>
                </button>
              ))}
              {filteredSections.length === 0 && (
                <div className="tree-empty">{'No settings found'}</div>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group} className="settings-nav-group">
                <div className="settings-nav-label">{tx(group)}</div>
                {SECTIONS.filter((s) => s.groupKey === group).map((section) => (
                  <button
                    key={section.id}
                    className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                    onClick={() => setActiveSection(section.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={section.icon} />
                    </svg>
                    <span>{tx(section.labelKey)}</span>
                  </button>
                ))}
              </div>
            ))
          )}
          </div>
        </div>
      </div>

      <div className="settings-resizer" ref={attachResizer} role="separator" aria-orientation="vertical" />

      <div className="settings-content">
        {activeSection === 'appearance' && <AppearanceSettingsPanel state={state} />}
        {activeSection === 'providers' && <ProvidersSettingsPanel state={state} />}
        {activeSection === 'models' && <ModelsSettingsPanel state={state} />}
        {activeSection === 'decisionModels' && <DecisionModelsSettingsPanel />}
        {activeSection === 'agent' && <AgentSettingsPanel state={state} />}
        {activeSection === 'wiki' && (
          <div className="settings-section">
            <h2>{'Wiki (LLM knowledge base)'}</h2>
            <p className="settings-desc">{'An interlinked markdown wiki the agent writes and maintains itself — pages, index, log, and a link graph under ~/.pawn/wiki. Open the folder as an Obsidian vault if you like.'}</p>
            <WikiPanel />
          </div>
        )}
        {activeSection === 'hooks' && (
          <div className="settings-section">
            <h2>{'Hooks'}</h2>
            <p className="settings-desc">{'Run scripts at agent lifecycle points (Claude/Codex-compatible). Sources merge with dedupe so the same command is not run twice. PreToolUse deny wins even in YOLO.'}</p>
            <HooksSettingsPanel />
          </div>
        )}
        {activeSection === 'subagents' && (
          <div className="settings-section">
            <h2>{'Subagents'}</h2>
            <AgentsSettingsPanel />
          </div>
        )}
        {activeSection === 'usage' && (
          <div className="settings-section">
            <h2>{'Usage history'}</h2>
            <UsageSettingsPanel />
            <div className="settings-card" style={{ marginTop: 16 }}>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{'Chat spend cap ($)'}</span>
                  <span className="settings-row-desc">{'Soft-stop the agent when this chat\'s USD cost reaches the cap. 0 = unlimited.'}</span>
                </div>
                <label className="budget-field">
                  <span className="budget-field-prefix" aria-hidden="true">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-label={'Chat spend cap ($)'}
                    value={sessionBudgetUsd || ''}
                    placeholder="0"
                    onChange={(e) => setSessionBudgetUsd(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{'Daily spend cap ($)'}</span>
                  <span className="settings-row-desc">{'Soft-stop when today’s on-device usage reaches the cap. 0 = unlimited.'}</span>
                </div>
                <label className="budget-field">
                  <span className="budget-field-prefix" aria-hidden="true">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-label={'Daily spend cap ($)'}
                    value={dailyBudgetUsd || ''}
                    placeholder="0"
                    onChange={(e) => setDailyBudgetUsd(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
        {activeSection === 'plugins' && <PluginsSettingsPanel state={state} />}
        {activeSection === 'skillStore' && <SkillStorePanel state={state} />}
        {activeSection === 'mcp' && <McpSettingsPanel state={state} />}
        {activeSection === 'connections' && <ConnectionsSettingsPanel state={state} />}
        {activeSection === 'telegram' && <TelegramSettingsPanel />}
        {activeSection === 'remote' && <RemoteSettingsPanel />}
        {activeSection === 'system' && <SystemSettingsPanel state={state} />}
        {activeSection === 'shortcuts' && <ShortcutsSettingsPanel state={state} />}
        {activeSection === 'data' && <DataSettingsPanel state={state} />}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete.name} ${'Delete'}`}
          message={
            confirmDelete.type === 'provider'
              ? 'Delete this provider? Models linked to it may stop working.'
              : 'Delete this model? This can\'t be undone.'
          }
          confirmLabel={'Confirm'}
          cancelLabel={'Cancel'}
          onConfirm={() => { void handleConfirmDelete() }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
