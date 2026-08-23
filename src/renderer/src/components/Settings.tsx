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
import './Settings.css'

export default function Settings({
  onSidebarWidthChange,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward
}: SettingsProps): React.JSX.Element {
  const state = useSettingsState({ onSidebarWidthChange })
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
    handleConfirmDelete
  } = state

  return (
    <div className={`settings-page ${navOpen ? '' : 'nav-collapsed'}`}>
      <div className="settings-header">
        <div className="settings-header-left">
          <button
            className="settings-header-back"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={t('settings.toggleNav')}
            title={t('settings.toggleNav')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
        </div>
      </div>
      <div className="settings-sidebar">
        <div className="settings-sidebar-top-row">
          <span className="sidebar-logo">Pawn</span>
        </div>
        <div className="settings-nav">
          {groups.map((group) => (
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
          ))}
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
