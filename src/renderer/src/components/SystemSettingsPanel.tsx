import type { SettingsState } from './settingsState'
import { IconGitHub } from './icons'
import Switch from './Switch'

const REPO_URL = 'https://github.com/parkjangwon/pawn'

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
          <div className="theme-toggle" role="group" aria-label={t('settings.systemSection.sleepPrevention')}>
            <button className={sleepPrevention === 'off' ? 'active' : ''} aria-pressed={sleepPrevention === 'off'} onClick={() => setSleepPrevention('off')}>{t('settings.systemSection.sleepOff')}</button>
            <button className={sleepPrevention === 'sleep' ? 'active' : ''} aria-pressed={sleepPrevention === 'sleep'} onClick={() => setSleepPrevention('sleep')}>{t('settings.systemSection.sleepSystem')}</button>
            <button className={sleepPrevention === 'display' ? 'active' : ''} aria-pressed={sleepPrevention === 'display'} onClick={() => setSleepPrevention('display')}>{t('settings.systemSection.sleepDisplay')}</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.taskNotifications')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.taskNotificationsDesc')}</span>
          </div>
          <Switch
            checked={taskNotificationsEnabled}
            onCheckedChange={setTaskNotificationsEnabled}
            aria-label={t('settings.systemSection.taskNotifications')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.trayEnabled')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.trayEnabledDesc')}</span>
          </div>
          <Switch
            checked={trayVisible}
            onCheckedChange={(next) => {
              setTrayVisible(next)
              void window.api.tray?.setEnabled?.(next)?.catch?.(() => {})
            }}
            aria-label={t('settings.systemSection.trayEnabled')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.confirmQuit')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.confirmQuitDesc')}</span>
          </div>
          <Switch
            checked={confirmQuit}
            onCheckedChange={setConfirmQuit}
            aria-label={t('settings.systemSection.confirmQuit')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.checkUpdatesOnLaunch')}</span>
            <span className="settings-row-desc">{t('settings.systemSection.checkUpdatesOnLaunchDesc')}</span>
          </div>
          <Switch
            checked={checkUpdatesOnLaunch}
            onCheckedChange={setCheckUpdatesOnLaunch}
            aria-label={t('settings.systemSection.checkUpdatesOnLaunch')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.systemSection.checkUpdates')}</span>
            <span className="settings-row-desc">
              {updateMsg || t('settings.systemSection.checkUpdatesDesc')}
            </span>
          </div>
          <div className="settings-row-actions">
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
                  .catch((e) => {
                    console.warn('[system-settings]', e)
                    setUpdateMsg(t('common.operationFailed'))
                  })
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
                  .catch((e) => {
                    console.warn('[system-settings]', e)
                    setUpdateMsg(t('common.operationFailed'))
                  })
                  .finally(() => setUpdateChecking(false))
              }}
            >
              {t('settings.systemSection.downloadInstall')}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label settings-row-label-icon">
              <IconGitHub size={16} />
              {t('settings.systemSection.openGitHub')}
            </span>
            <span className="settings-row-desc">{t('settings.systemSection.openGitHubDesc')}</span>
          </div>
          <button
            type="button"
            className="btn-action btn-with-icon"
            onClick={() => {
              window.api?.browser?.open?.(REPO_URL)?.catch?.(() => {})
            }}
          >
            <IconGitHub size={14} />
            {t('settings.systemSection.openGitHubAction')}
          </button>
        </div>
      </div>
    </div>
  )
}
