import type { SettingsState } from './settingsState'

export default function SystemSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    sleepPrevention,
    setSleepPrevention,
    taskNotificationsEnabled,
    setTaskNotificationsEnabled,
    trayVisible,
    setTrayVisible,
    confirmQuit,
    setConfirmQuit,
    checkUpdatesOnLaunch,
    setCheckUpdatesOnLaunch,
    updateMsg,
    setUpdateMsg,
    updateChecking,
    setUpdateChecking
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.systemSection.title')}</h2>
      <p className="settings-desc">{t('settings.systemSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.sleepPrevention')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.sleepPreventionDesc')}</span>
          </div>
          <div className="theme-toggle">
            <button className={sleepPrevention === 'off' ? 'active' : ''} onClick={() => setSleepPrevention('off')}>{t('settings.systemSection.sleepOff')}</button>
            <button className={sleepPrevention === 'sleep' ? 'active' : ''} onClick={() => setSleepPrevention('sleep')}>{t('settings.systemSection.sleepSystem')}</button>
            <button className={sleepPrevention === 'display' ? 'active' : ''} onClick={() => setSleepPrevention('display')}>{t('settings.systemSection.sleepDisplay')}</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.taskNotifications')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.taskNotificationsDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={taskNotificationsEnabled}
              onChange={(e) => setTaskNotificationsEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.trayEnabled')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.trayEnabledDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={trayVisible}
              onChange={(e) => {
                const next = e.target.checked
                setTrayVisible(next)
                void window.api.tray?.setEnabled?.(next)?.catch?.(() => {})
              }}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.confirmQuit')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.confirmQuitDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={confirmQuit}
              onChange={(e) => setConfirmQuit(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.checkUpdatesOnLaunch')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.checkUpdatesOnLaunchDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={checkUpdatesOnLaunch}
              onChange={(e) => setCheckUpdatesOnLaunch(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.checkUpdates')}</span>
            <span className="settings-row-desc">
              {updateMsg || t('settings.systemSection.checkUpdatesDesc')}
            </span>
          </div>
          <div className="settings-row-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-action"
              disabled={updateChecking}
              onClick={() => {
                if (!window.api?.checkForUpdates) {
                  setUpdateMsg(t('settings.systemSection.desktopOnly'))
                  return
                }
                setUpdateChecking(true)
                void window.api
                  .checkForUpdates()
                  .then((r) => {
                    if (r.error && !r.latest) {
                      setUpdateMsg(r.error)
                      return
                    }
                    if (r.updateAvailable) {
                      setUpdateMsg(
                        t('settings.systemSection.updateAvailable', {
                          latest: r.latest,
                          current: r.current
                        })
                      )
                    } else {
                      setUpdateMsg(
                        t('settings.systemSection.upToDate', { current: r.current })
                      )
                    }
                  })
                  .catch((e) => setUpdateMsg(String(e)))
                  .finally(() => setUpdateChecking(false))
              }}
            >
              {updateChecking
                ? t('settings.systemSection.checking')
                : t('settings.systemSection.checkUpdates')}
            </button>
            <button
              type="button"
              className="btn-action"
              disabled={updateChecking}
              onClick={() => {
                if (!window.api?.downloadUpdate) {
                  setUpdateMsg(t('settings.systemSection.desktopOnly'))
                  return
                }
                setUpdateChecking(true)
                setUpdateMsg(t('settings.systemSection.downloading'))
                void window.api
                  .downloadUpdate()
                  .then((r) => {
                    if (r.alreadyLatest) {
                      setUpdateMsg(
                        t('settings.systemSection.upToDate', {
                          current: r.current || ''
                        })
                      )
                      return
                    }
                    if (r.ok && r.path) {
                      setUpdateMsg(
                        t('settings.systemSection.downloadOpened', { path: r.path })
                      )
                    } else {
                      setUpdateMsg(r.error || t('settings.systemSection.downloadFailed'))
                    }
                  })
                  .catch((e) => setUpdateMsg(String(e)))
                  .finally(() => setUpdateChecking(false))
              }}
            >
              {t('settings.systemSection.downloadInstall')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
