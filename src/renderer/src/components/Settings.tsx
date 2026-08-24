import NavControls from './NavControls'
import ConfirmDialog from './ConfirmDialog'
import AppearanceSettingsPanel from './AppearanceSettingsPanel'
import ProvidersSettingsPanel from './ProvidersSettingsPanel'
import ModelsSettingsPanel from './ModelsSettingsPanel'
import AgentSettingsPanel from './AgentSettingsPanel'
import MemorySettingsPanel from './MemorySettingsPanel'
import HooksSettingsPanel from './HooksSettingsPanel'
import AgentsSettingsPanel from './AgentsSettingsPanel'
import UsageSettingsPanel from './UsageSettingsPanel'
import PluginsSettingsPanel from './PluginsSettingsPanel'
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

import { useState, useMemo } from 'react'

export default function Settings({
  onSidebarWidthChange,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward
}: SettingsProps): React.JSX.Element {
  const state = useSettingsState({ onSidebarWidthChange })
  const [searchQuery, setSearchQuery] = useState('')
  const {
    t,
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
    return SECTIONS.filter((s) => t(s.labelKey).toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [searchQuery, t])

  const sidebarShortcut = formatCombo(keybindings['toggle-sidebar'])

  return (
    <div className={`settings-page ${navOpen ? '' : 'nav-collapsed'}`}>
      <div className="settings-header">
        <div className="settings-header-left">
          <Tooltip label={t('settings.toggleNav')} shortcut={sidebarShortcut} placement="bottom">
            <button
              className="settings-header-back"
              onClick={() => setNavOpen((v) => !v)}
              aria-label={t('settings.toggleNav')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.searchPlaceholder', { defaultValue: '설정 검색...' })}
              aria-label="Settings search"
            />
            {searchQuery && (
              <button
                type="button"
                className="sidebar-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear"
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
                {t('settings.searchResults', { defaultValue: '검색 결과' })} ({filteredSections.length})
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
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
              {filteredSections.length === 0 && (
                <div className="tree-empty">{t('settings.noResults', { defaultValue: '일치하는 설정 없음' })}</div>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group} className="settings-nav-group">
                <div className="settings-nav-label">{t(group)}</div>
                {SECTIONS.filter((s) => s.groupKey === group).map((section) => (
                  <button
                    key={section.id}
                    className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                    onClick={() => setActiveSection(section.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={section.icon} />
                    </svg>
                    <span>{t(section.labelKey)}</span>
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
        {activeSection === 'agent' && <AgentSettingsPanel state={state} />}
        {activeSection === 'memory' && (
          <div className="settings-section">
            <h2>{t('settings.memorySection.title')}</h2>
            <p className="settings-desc">{t('settings.memorySection.desc')}</p>
            <MemorySettingsPanel />
          </div>
        )}
        {activeSection === 'hooks' && (
          <div className="settings-section">
            <h2>{t('settings.hooksSection.title')}</h2>
            <p className="settings-desc">{t('settings.hooksSection.desc')}</p>
            <HooksSettingsPanel />
          </div>
        )}
        {activeSection === 'subagents' && (
          <div className="settings-section">
            <h2>{t('settings.agentsSection.title')}</h2>
            <AgentsSettingsPanel />
          </div>
        )}
        {activeSection === 'usage' && (
          <div className="settings-section">
            <h2>{t('settings.usageSection.title')}</h2>
            <UsageSettingsPanel />
            <div className="settings-card" style={{ marginTop: 16 }}>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.usageSection.sessionBudget')}</span>
                  <span className="settings-row-desc">{t('settings.usageSection.sessionBudgetDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 96 }}
                  value={sessionBudgetUsd || ''}
                  placeholder="0"
                  onChange={(e) => setSessionBudgetUsd(Number(e.target.value) || 0)}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.usageSection.dailyBudget')}</span>
                  <span className="settings-row-desc">{t('settings.usageSection.dailyBudgetDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 96 }}
                  value={dailyBudgetUsd || ''}
                  placeholder="0"
                  onChange={(e) => setDailyBudgetUsd(Number(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        )}
        {activeSection === 'plugins' && <PluginsSettingsPanel state={state} />}
        {activeSection === 'mcp' && <McpSettingsPanel state={state} />}
        {activeSection === 'connections' && <ConnectionsSettingsPanel state={state} />}
        {activeSection === 'system' && <SystemSettingsPanel state={state} />}
        {activeSection === 'shortcuts' && <ShortcutsSettingsPanel state={state} />}
        {activeSection === 'data' && <DataSettingsPanel state={state} />}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete.name} ${t('common.delete')}`}
          message={
            confirmDelete.type === 'provider'
              ? t('confirmDialog.deleteProviderConfirm')
              : t('confirmDialog.deleteModelConfirm')
          }
          confirmLabel={t('confirmDialog.confirm')}
          cancelLabel={t('confirmDialog.cancel')}
          onConfirm={() => { void handleConfirmDelete() }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
