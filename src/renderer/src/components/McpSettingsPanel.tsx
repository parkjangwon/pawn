import { MCP_TEMPLATES } from '../agent/mcpTemplates'
import { useMcpStore } from '../stores/mcp'
import type { SettingsState } from './settingsState'

export default function McpSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    mcpAdding,
    projectPath,
    setMcpAdding,
    setMcpFormError,
    mcpLoading,
    mcpServers,
    toggleMcpServer,
    handleRemoveMcpServer,
    showAddMcpServer,
    setShowAddMcpServer,
    mcpScope,
    setMcpScope,
    mcpForm,
    setMcpForm,
    mcpFormError,
    handleAddMcpServer
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.mcpSection.title')}</h2>
      <p className="settings-desc">{t('settings.mcpSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row-info" style={{ marginBottom: 8 }}>
          <span className="settings-row-label">{t('settings.mcpSection.templates')}</span>
          <span className="settings-row-desc">
            One-click install common MCP servers (stdio or HTTP). Add secrets in env after install.
          </span>
        </div>
        <div className="mcp-templates" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {MCP_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="test-btn"
              title={tpl.description}
              disabled={mcpAdding || (tpl.scope === 'project' && !projectPath)}
              onClick={() => {
                void (async () => {
                  setMcpAdding(true)
                  setMcpFormError(null)
                  const res = await useMcpStore.getState().addServer(
                    tpl.scope,
                    tpl.scope === 'project' ? projectPath || undefined : undefined,
                    tpl.id,
                    tpl.input as McpServerInput
                  )
                  setMcpAdding(false)
                  if (!res.ok) setMcpFormError(res.error || 'Template install failed')
                  else void useMcpStore.getState().refresh(projectPath || undefined)
                })()
              }}
            >
              + {tpl.name}
            </button>
          ))}
        </div>
        {mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{t('common.loading')}</div>}
        {!mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{t('settings.mcpSection.empty')}</div>}
        {mcpServers.map((server) => (
          <div key={server.id} className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">
                {server.id}
                <span className={`mcp-status-badge ${server.disabled ? 'disabled' : server.status}`}>
                  {server.disabled
                    ? t('settings.mcpSection.statusDisabled')
                    : server.status === 'connected'
                      ? t('settings.mcpSection.statusConnected', { count: server.toolCount })
                      : server.status === 'error'
                        ? t('settings.mcpSection.statusError')
                        : t('settings.mcpSection.statusConnecting')}
                </span>
              </span>
              <span className="settings-row-desc">
                {!server.disabled && server.status === 'error'
                  ? server.error
                  : t(`settings.mcpSection.source.${server.source}`)}
              </span>
            </div>
            <div className="settings-row-actions">
              {!server.disabled && server.status === 'error' && (
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => void useMcpStore.getState().reconnect(projectPath || undefined)}
                >
                  {t('settings.mcpSection.retry')}
                </button>
              )}
              <label className="toggle-switch">
                <input type="checkbox" checked={!server.disabled} onChange={() => void toggleMcpServer(server.id)} />
                <span className="toggle-slider" />
              </label>
              {server.source !== 'user-claude' && (
                <button className="delete-btn" title={t('common.delete')} onClick={() => void handleRemoveMcpServer(server)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              )}
            </div>
          </div>
        ))}
        <p className="settings-mcp-hint">{t('settings.mcpSection.hint')}</p>
      </div>

      {showAddMcpServer ? (
        <div className="settings-card add-form">
          <div className="theme-toggle">
            <button className={mcpScope === 'project' ? 'active' : ''} disabled={!projectPath} onClick={() => setMcpScope('project')}>{t('settings.mcpSection.scopeProject')}</button>
            <button className={mcpScope === 'user' ? 'active' : ''} onClick={() => setMcpScope('user')}>{t('settings.mcpSection.scopeUser')}</button>
          </div>
          {mcpScope === 'project' && !projectPath && <div className="settings-row-desc">{t('settings.mcpSection.noProjectForScope')}</div>}
          <input placeholder={t('settings.mcpSection.idPlaceholder')} value={mcpForm.id} onChange={(e) => setMcpForm({ ...mcpForm, id: e.target.value })} />
          <input placeholder={t('settings.mcpSection.commandPlaceholder')} value={mcpForm.command} onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })} />
          <input placeholder={t('settings.mcpSection.argsPlaceholder')} value={mcpForm.args} onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })} />
          <textarea
            className="mcp-env-input"
            placeholder={t('settings.mcpSection.envPlaceholder')}
            value={mcpForm.env}
            onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
            rows={3}
          />
          {mcpFormError && <div className="settings-row-desc mcp-form-error">{mcpFormError}</div>}
          <div className="form-actions">
            <button className="btn-primary" onClick={() => void handleAddMcpServer()} disabled={mcpAdding || !mcpForm.id.trim() || !mcpForm.command.trim() || (mcpScope === 'project' && !projectPath)}>
              {mcpAdding ? t('common.loading') : t('common.save')}
            </button>
            <button className="btn-cancel" onClick={() => { setShowAddMcpServer(false); setMcpFormError(null) }}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddMcpServer(true)}>{t('settings.mcpSection.add')}</button>
      )}
    </div>
  )
}
