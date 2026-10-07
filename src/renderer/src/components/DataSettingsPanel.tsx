import { useState } from 'react'
import { useProviderStore } from '../stores/provider'
import type { SettingsState } from './settingsState'
import ConfirmDialog from './ConfirmDialog'

export default function DataSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    providers,
    models,
    routingMode,
    defaultSendMode,
    importMsg,
    setImportMsg,
    backupMsg,
    setBackupMsg,
    pawnPaths
  } = state
  // Destructive backup/restore actions confirm through a styled dialog.
  const [confirmAction, setConfirmAction] = useState<'backup' | 'restore' | null>(null)

  return (
    <div className="settings-section">
      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction === 'backup'
              ? 'Full local backup'
              : 'Import data'
          }
          message={
            confirmAction === 'backup'
              ? 'Full backup includes API keys and connection tokens. Store the zip securely. Continue?'
              : 'Restore will replace local Pawn data (~/.pawn). A copy of the current folder is kept. Restart Pawn after restore. Continue?'
          }
          confirmLabel={confirmAction === 'backup' ? 'Full local backup' : 'Import data'}
          danger={confirmAction === 'restore'}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction
            setConfirmAction(null)
            if (action === 'backup') {
              void window.api.exportBackup?.({ excludeSecrets: false }).then((r) => {
                if (r.cancelled) setBackupMsg('Backup cancelled')
                else if (r.ok && r.path)
                  setBackupMsg(`Saved backup to ${r.path}`)
                else setBackupMsg(r.error || 'Backup failed')
              }).catch(() => setBackupMsg('Backup failed'))
            } else if (action === 'restore') {
              void window.api.importBackup?.().then((r) => {
                if (r.cancelled) setBackupMsg('Backup cancelled')
                else if (r.ok)
                  setBackupMsg(
                    `Restored. Previous data saved at ${r.backupOfPrevious || ''}. Please restart Pawn.`
                  )
                else setBackupMsg(r.error || 'Restore failed')
              }).catch(() => setBackupMsg('Restore failed'))
            }
          }}
        />
      )}
      <h2>{'Data'}</h2>
      <p className="settings-desc">{'Manage your data and configuration'}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Export data'}</span>
            <span className="settings-row-desc">{'Export all settings and configuration to a file'}</span>
          </div>
          <button
            className="btn-action"
            onClick={() => {
              const data = {
                _note: 'API keys are not exported; re-enter keys after import.',
                providers: providers.map((p) => {
                  const { apiKey, ...rest } = p
                  return rest
                }),
                models,
                settings: { routingMode, defaultSendMode }
              }
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'pawn-settings.json'
              a.click()
              URL.revokeObjectURL(url)
              setImportMsg(`Exported ${'pawn-settings.json'}`)
            }}
          >
            {'Export data'}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Import data'}</span>
            <span className="settings-row-desc">
              {importMsg || 'Import settings from a previously exported file'}
            </span>
          </div>
          <button
            className="btn-action"
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.json'
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (!file) return
                try {
                  const text = await file.text()
                  const data = JSON.parse(text) as {
                    providers?: typeof providers
                    models?: typeof models
                  }
                  const store = useProviderStore.getState()
                  let n = 0
                  if (Array.isArray(data.providers)) {
                    data.providers.forEach((p) => {
                      store.addProvider(p)
                      n++
                    })
                  }
                  if (Array.isArray(data.models)) {
                    data.models.forEach((m) => {
                      store.addModel(m)
                      n++
                    })
                  }
                  if (n === 0) {
                    setImportMsg('No providers or models found in that file')
                  } else {
                    setImportMsg(`Imported ${n} items`)
                  }
                } catch (err) {
                  setImportMsg(
                    `Import failed: ${err instanceof Error ? err.message : String(err)}`
                  )
                }
              }
              input.click()
            }}
          >
            {'Import data'}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Full local backup'}</span>
            {backupMsg ? (
              <span className="settings-row-desc">{backupMsg}</span>
            ) : (
              <span className="settings-row-desc">{'Zip ~/.pawn (config, chats DB, memory). API keys in config.json are included — store the zip safely.'}</span>
            )}
            <span className="settings-row-desc vision-fallback-warn">
              {'The full backup includes API keys — store the file somewhere safe.'}
            </span>
          </div>
          <div className="settings-row-actions">
            <button
              className="btn-action"
              onClick={() => {
                if (!window.api?.exportBackup) {
                  setBackupMsg('Available in the desktop app')
                  return
                }
                void window.api.exportBackup({ excludeSecrets: true }).then((r) => {
                  if (r.cancelled) setBackupMsg('Backup cancelled')
                  else if (r.ok && r.path)
                    setBackupMsg(
                      `Safe backup saved to ${r.path} (API keys stripped)`
                    )
                  else setBackupMsg(r.error || 'Backup failed')
                }).catch(() => setBackupMsg('Backup failed'))
              }}
            >
              {'Backup (no secrets)'}
            </button>
            <button
              className="btn-action"
              onClick={() => {
                if (!window.api?.exportBackup) {
                  setBackupMsg('Available in the desktop app')
                  return
                }
                setConfirmAction('backup')
              }}
            >
              {'Full local backup'}
            </button>
            <button
              className="btn-action"
              onClick={() => {
                if (!window.api?.importBackup) {
                  setBackupMsg('Available in the desktop app')
                  return
                }
                setConfirmAction('restore')
              }}
            >
              {'Restore backup'}
            </button>
          </div>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Config file'}</span>
            <span className="settings-row-desc">{'View and edit the raw configuration file'}</span>
            {pawnPaths?.configPath && <span className="plugin-source">{pawnPaths.configPath}</span>}
          </div>
          <div className="settings-row-actions">
            <button className="btn-action" disabled={!pawnPaths?.configPath} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.configPath) }}>
              {'Open'}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Database'}</span>
            <span className="settings-row-desc">{'Manage the local database'}</span>
            {pawnPaths?.dataDir && <span className="plugin-source">{pawnPaths.dataDir}</span>}
          </div>
          <div className="settings-row-actions">
            <button className="btn-action" disabled={!pawnPaths?.dataDir} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.dataDir) }}>
              {'Open'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
