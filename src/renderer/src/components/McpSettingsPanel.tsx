import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { MCP_TEMPLATES } from '../agent/mcpTemplates'
import { useMcpStore, type McpServerSummary } from '../stores/mcp'
import ConfirmDialog from './ConfirmDialog'
import type { SettingsState } from './settingsState'
import Button from './Button'
import Input, { Textarea } from './Input'
import Switch from './Switch'

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
  const [pendingDelete, setPendingDelete] = useState<McpServerSummary | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const retryServer = (id: string): void => {
    setRetryingId(id)
    void useMcpStore
      .getState()
      .reconnectServer(projectPath || undefined, id)
      .finally(() => setRetryingId(null))
  }

  return (
    <div className="settings-section">
      {pendingDelete && (
        <ConfirmDialog
          title={t('settings.mcpSection.deleteConfirmTitle')}
          message={t('settings.mcpSection.deleteConfirm', { id: pendingDelete.id })}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={() => {
            const target = pendingDelete
            setPendingDelete(null)
            void handleRemoveMcpServer(target)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <h2>{t('settings.mcpSection.title')}</h2>
      <p className="settings-desc">{t('settings.mcpSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row-info" style={{ marginBottom: 8 }}>
          <span className="settings-row-label">{t('settings.mcpSection.templates')}</span>
          <span className="settings-row-desc">
            {t('settings.mcpSection.templatesDesc')}
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
                  if (!res.ok) setMcpFormError(res.error || t('settings.mcpSection.addFailed'))
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
              {!server.disabled && (server.status === 'error' || server.status === 'connecting') && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={retryingId === server.id}
                  onClick={() => retryServer(server.id)}
                >
                  {retryingId === server.id ? t('common.loading') : t('settings.mcpSection.retry')}
                </Button>
              )}
              <Switch
                checked={!server.disabled}
                onCheckedChange={() => void toggleMcpServer(server.id)}
                aria-label={server.id}
              />
              {server.source !== 'user-claude' && (
                <button
                  className="delete-btn"
                  title={t('common.delete')}
                  aria-label={t('common.delete') + ': ' + server.id}
                  onClick={() => setPendingDelete(server)}
                >
                  <Trash2 size={14} />
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
          <Input placeholder={t('settings.mcpSection.idPlaceholder')} value={mcpForm.id} onChange={(e) => setMcpForm({ ...mcpForm, id: e.target.value })} />
          <Input placeholder={t('settings.mcpSection.commandPlaceholder')} value={mcpForm.command} onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })} />
          <Input placeholder={t('settings.mcpSection.argsPlaceholder')} value={mcpForm.args} onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })} />
          <Textarea
            className="mcp-env-input"
            placeholder={t('settings.mcpSection.envPlaceholder')}
            value={mcpForm.env}
            onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
            rows={3}
          />
          {mcpFormError && <div className="settings-row-desc mcp-form-error">{mcpFormError}</div>}
          <div className="form-actions">
            <Button onClick={() => void handleAddMcpServer()} disabled={mcpAdding || !mcpForm.id.trim() || !mcpForm.command.trim() || (mcpScope === 'project' && !projectPath)}>
              {mcpAdding ? t('common.loading') : t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => { setShowAddMcpServer(false); setMcpFormError(null) }}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddMcpServer(true)}>{t('settings.mcpSection.add')}</button>
      )}
    </div>
  )
}
