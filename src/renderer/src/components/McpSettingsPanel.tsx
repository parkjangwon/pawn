import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { MCP_TEMPLATES } from '../agent/mcpTemplates'
import { useMcpStore, type McpServerSummary } from '../stores/mcp'
import ConfirmDialog from './ConfirmDialog'
import type { SettingsState } from './settingsState'
import Button from './Button'
import Input, { Textarea } from './Input'
import Switch from './Switch'
import { tx } from '../i18n'

export default function McpSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
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
          title={'Remove MCP server?'}
          message={`Remove ${pendingDelete.id}? Its tools disappear from the agent until re-added.`}
          confirmLabel={'Delete'}
          danger
          onConfirm={() => {
            const target = pendingDelete
            setPendingDelete(null)
            void handleRemoveMcpServer(target)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <h2>{'MCP'}</h2>
      <p className="settings-desc">{'MCP servers configured for this device, added through Pawn, or scoped to this project — the agent can call their tools alongside its built-in ones.'}</p>
      <div className="settings-card">
        <div className="settings-row-info" style={{ marginBottom: 8 }}>
          <span className="settings-row-label">{'Templates'}</span>
          <span className="settings-row-desc">
            {'One-click install common MCP servers (stdio or HTTP). Add secrets in env after install.'}
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
                  if (!res.ok) setMcpFormError(res.error || 'Couldn\'t add the server.')
                  else void useMcpStore.getState().refresh(projectPath || undefined)
                })()
              }}
            >
              + {tpl.name}
            </button>
          ))}
        </div>
        {mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{'Loading…'}</div>}
        {!mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{'No MCP servers found'}</div>}
        {mcpServers.map((server) => (
          <div key={server.id} className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">
                {server.id}
                <span className={`mcp-status-badge ${server.disabled ? 'disabled' : server.status}`}>
                  {server.disabled
                    ? 'Disabled'
                    : server.status === 'connected'
                      ? `Connected · ${server.toolCount} tools`
                      : server.status === 'error'
                        ? 'Error'
                        : 'Connecting…'}
                </span>
              </span>
              <span className="settings-row-desc">
                {!server.disabled && server.status === 'error'
                  ? server.error
                  : tx(`settings.mcpSection.source.${server.source}`)}
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
                  {retryingId === server.id ? 'Loading…' : 'Retry'}
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
                  title={'Delete'}
                  aria-label={'Delete' + ': ' + server.id}
                  onClick={() => setPendingDelete(server)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        <p className="settings-mcp-hint">{'Servers from ~/.claude.json are read-only here — manage those with Claude Code. Servers you add below live in Pawn\'s own config and can be edited or removed anytime.'}</p>
      </div>

      {showAddMcpServer ? (
        <div className="settings-card add-form">
          <div className="theme-toggle">
            <button className={mcpScope === 'project' ? 'active' : ''} disabled={!projectPath} onClick={() => setMcpScope('project')}>{'This project'}</button>
            <button className={mcpScope === 'user' ? 'active' : ''} onClick={() => setMcpScope('user')}>{'All projects'}</button>
          </div>
          {mcpScope === 'project' && !projectPath && <div className="settings-row-desc">{'Open a project to add a project-scoped server.'}</div>}
          <Input placeholder={'Server id (e.g. codegraph)'} value={mcpForm.id} onChange={(e) => setMcpForm({ ...mcpForm, id: e.target.value })} />
          <Input placeholder={'Command (e.g. npx)'} value={mcpForm.command} onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })} />
          <Input placeholder={'Arguments, space-separated (e.g. -y @some/mcp-server)'} value={mcpForm.args} onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })} />
          <Textarea
            className="mcp-env-input"
            placeholder={'Environment variables, one per line: KEY=value'}
            value={mcpForm.env}
            onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
            rows={3}
          />
          {mcpFormError && <div className="settings-row-desc mcp-form-error">{mcpFormError}</div>}
          <div className="form-actions">
            <Button onClick={() => void handleAddMcpServer()} disabled={mcpAdding || !mcpForm.id.trim() || !mcpForm.command.trim() || (mcpScope === 'project' && !projectPath)}>
              {mcpAdding ? 'Loading…' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => { setShowAddMcpServer(false); setMcpFormError(null) }}>{'Cancel'}</Button>
          </div>
        </div>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddMcpServer(true)}>{'Add MCP server'}</button>
      )}
    </div>
  )
}
