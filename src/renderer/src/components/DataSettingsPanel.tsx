import { useProviderStore } from '../stores/provider'
import type { SettingsState } from './settingsState'

export default function DataSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
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

  return (
    <div className="settings-section">
      <h2>{t('settings.dataSection.title')}</h2>
      <p className="settings-desc">{t('settings.dataSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.dataSection.export')}</span>
            <span className="settings-row-desc">{t('settings.dataSection.exportDesc')}</span>
          </div>
          <button
            className="btn-action"
            onClick={() => {
              const data = {
                _note: t('settings.dataSection.exportKeyNote'),
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
            }}
          >
            {t('settings.dataSection.export')}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.dataSection.import')}</span>
            <span className="settings-row-desc">
              {importMsg || t('settings.dataSection.importDesc')}
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
                const text = await file.text()
                try {
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
                    setImportMsg(t('settings.dataSection.importEmpty'))
                  } else {
                    setImportMsg(t('settings.dataSection.importOk', { count: n }))
                  }
                } catch (err) {
                  setImportMsg(
                    t('settings.dataSection.importFailed', {
                      error: err instanceof Error ? err.message : String(err)
                    })
                  )
                }
              }
              input.click()
            }}
          >
            {t('settings.dataSection.import')}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.dataSection.fullBackup')}</span>
            <span className="settings-row-desc">
              {backupMsg || t('settings.dataSection.fullBackupDesc')}
            </span>
          </div>
          <div className="settings-row-actions" style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-action"
              onClick={() => {
                if (!window.api?.exportBackup) {
                  setBackupMsg(t('settings.dataSection.desktopOnly'))
                  return
                }
                void window.api.exportBackup({ excludeSecrets: true }).then((r) => {
                  if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                  else if (r.ok && r.path)
                    setBackupMsg(
                      t('settings.dataSection.backupOkSafe', { path: r.path })
                    )
                  else setBackupMsg(r.error || t('settings.dataSection.backupFailed'))
                }).catch(() => setBackupMsg(t('settings.dataSection.backupFailed')))
              }}
            >
              {t('settings.dataSection.fullBackupSafe')}
            </button>
            <button
              className="btn-action"
              onClick={() => {
                if (!window.api?.exportBackup) {
                  setBackupMsg(t('settings.dataSection.desktopOnly'))
                  return
                }
                if (!window.confirm(t('settings.dataSection.backupFullConfirm'))) return
                void window.api.exportBackup({ excludeSecrets: false }).then((r) => {
                  if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                  else if (r.ok && r.path)
                    setBackupMsg(t('settings.dataSection.backupOk', { path: r.path }))
                  else setBackupMsg(r.error || t('settings.dataSection.backupFailed'))
                }).catch(() => setBackupMsg(t('settings.dataSection.backupFailed')))
              }}
            >
              {t('settings.dataSection.fullBackup')}
            </button>
            <button
              className="btn-action"
              onClick={() => {
                if (!window.api?.importBackup) {
                  setBackupMsg(t('settings.dataSection.desktopOnly'))
                  return
                }
                if (!window.confirm(t('settings.dataSection.restoreConfirm'))) return
                void window.api.importBackup().then((r) => {
                  if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                  else if (r.ok)
                    setBackupMsg(
                      t('settings.dataSection.restoreOk', {
                        path: r.backupOfPrevious || ''
                      })
                    )
                  else setBackupMsg(r.error || t('settings.dataSection.restoreFailed'))
                }).catch(() => setBackupMsg(t('settings.dataSection.restoreFailed')))
              }}
            >
              {t('settings.dataSection.restoreBackup')}
            </button>
          </div>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.dataSection.configFile')}</span>
            <span className="settings-row-desc">{t('settings.dataSection.configFileDesc')}</span>
            {pawnPaths?.configPath && <span className="plugin-source">{pawnPaths.configPath}</span>}
          </div>
          <div className="settings-row-actions">
            <button className="btn-action" disabled={!pawnPaths?.configPath} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.configPath) }}>
              {t('settings.dataSection.open')}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.dataSection.database')}</span>
            <span className="settings-row-desc">{t('settings.dataSection.databaseDesc')}</span>
            {pawnPaths?.dataDir && <span className="plugin-source">{pawnPaths.dataDir}</span>}
          </div>
          <div className="settings-row-actions">
            <button className="btn-action" disabled={!pawnPaths?.dataDir} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.dataDir) }}>
              {t('settings.dataSection.open')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
