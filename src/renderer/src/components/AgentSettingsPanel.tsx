import PermissionsAlwaysPanel from './PermissionsAlwaysPanel'
import type { SettingsState } from './settingsState'

export default function AgentSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    routingMode,
    setRoutingMode,
    visionModelId,
    setVisionModel,
    visionCandidates,
    providers,
    defaultSendMode,
    setDefaultSendMode,
    permissionMode,
    setPermissionMode,
    shellSandbox,
    setShellSandbox,
    shellNetwork,
    setShellNetwork,
    shellCwdJail,
    setShellCwdJail,
    autoMemoryConsolidate,
    setAutoMemoryConsolidate
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.agentSection.title')}</h2>
      <p className="settings-desc">{t('settings.agentSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.routing')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.routingDesc')}</span>
          </div>
          <div className="theme-toggle">
            <button className={routingMode === 'auto' ? 'active' : ''} onClick={() => setRoutingMode('auto')}>{t('statusBar.auto')}</button>
            <button className={routingMode === 'manual' ? 'active' : ''} onClick={() => setRoutingMode('manual')}>{t('statusBar.manual')}</button>
          </div>
        </div>
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.visionFallback')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.visionFallbackDesc')}</span>
          </div>
          <select
            className="vision-fallback-select"
            value={visionModelId || ''}
            onChange={(e) => setVisionModel(e.target.value || null)}
          >
            <option value="">{t('settings.agentSection.visionFallbackAuto')}</option>
            {visionCandidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.modelId}
                {providers.find((p) => p.id === m.providerId) ? ` · ${providers.find((p) => p.id === m.providerId)!.name}` : ''}
              </option>
            ))}
          </select>
          {visionCandidates.length === 0 && (
            <div className="settings-row-desc vision-fallback-warn">
              {t('settings.agentSection.visionFallbackEmpty')}
            </div>
          )}
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.sendMode')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.sendModeDesc')}</span>
          </div>
          <select value={defaultSendMode} onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}>
            <option value="queue">{t('settings.agentSection.queue')}</option>
            <option value="steer">{t('settings.agentSection.steer')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.permissionMode')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.permissionModeDesc')}</span>
          </div>
          <div className="theme-toggle">
            <button className={permissionMode === 'ask' ? 'active' : ''} onClick={() => setPermissionMode('ask')}>{t('permission.ask')}</button>
            <button className={permissionMode === 'auto' ? 'active' : ''} onClick={() => setPermissionMode('auto')}>{t('permission.auto')}</button>
            <button className={permissionMode === 'yolo' ? 'active' : ''} onClick={() => setPermissionMode('yolo')}>{t('permission.yolo')}</button>
          </div>
        </div>
        <PermissionsAlwaysPanel />
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.shellSandbox')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.shellSandboxDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={shellSandbox} onChange={(e) => setShellSandbox(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.shellNetwork')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.shellNetworkDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={shellNetwork} onChange={(e) => setShellNetwork(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.cwdJail')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.cwdJailDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={shellCwdJail} onChange={(e) => setShellCwdJail(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.autoMemoryConsolidate')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.autoMemoryConsolidateDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={autoMemoryConsolidate} onChange={(e) => setAutoMemoryConsolidate(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </div>
  )
}
