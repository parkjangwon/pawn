import type { SettingsState } from './settingsState'
import { IconGitHub } from './icons'
import Switch from './Switch'

const REPO_URL = 'https://github.com/parkjangwon/pawn'

export default function SystemSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
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
      <h2>{'System'}</h2>
      <p className="settings-desc">{'Power and OS-level behavior.'}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Sleep prevention'}</span>
            <span className="settings-row-desc">{'Keep the system awake while the app runs. Display mode also prevents the screen from turning off.'}</span>
          </div>
          <div className="theme-toggle" role="group" aria-label={'Sleep prevention'}>
            <button className={sleepPrevention === 'off' ? 'active' : ''} aria-pressed={sleepPrevention === 'off'} onClick={() => setSleepPrevention('off')}>{'Off'}</button>
            <button className={sleepPrevention === 'sleep' ? 'active' : ''} aria-pressed={sleepPrevention === 'sleep'} onClick={() => setSleepPrevention('sleep')}>{'Prevent sleep'}</button>
            <button className={sleepPrevention === 'display' ? 'active' : ''} aria-pressed={sleepPrevention === 'display'} onClick={() => setSleepPrevention('display')}>{'Prevent sleep + screen'}</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Task complete notification'}</span>
            <span className="settings-row-desc">{'Show a notification once when an answer finishes (chat replies and coding work) while Pawn is in the background.'}</span>
          </div>
          <Switch
            checked={taskNotificationsEnabled}
            onCheckedChange={setTaskNotificationsEnabled}
            aria-label={'Task complete notification'}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Show in menu bar'}</span>
            <span className="settings-row-desc">{'Keep a Pawn icon in the system tray / menu bar (right-click for menu)'}</span>
          </div>
          <Switch
            checked={trayVisible}
            onCheckedChange={(next) => {
              setTrayVisible(next)
              void window.api.tray?.setEnabled?.(next)?.catch?.(() => {})
            }}
            aria-label={'Show in menu bar'}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Confirm before quitting'}</span>
            <span className="settings-row-desc">{'Only asks when quitting would cancel running agent work or pause scheduled automations. Turn off to always quit immediately.'}</span>
          </div>
          <Switch
            checked={confirmQuit}
            onCheckedChange={setConfirmQuit}
            aria-label={'Confirm before quitting'}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Check for updates on launch'}</span>
            <span className="settings-row-desc">{'Quietly compare with GitHub Releases when Pawn starts'}</span>
          </div>
          <Switch
            checked={checkUpdatesOnLaunch}
            onCheckedChange={setCheckUpdatesOnLaunch}
            aria-label={'Check for updates on launch'}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Check for updates'}</span>
            <span className="settings-row-desc">
              {updateMsg || 'Compare this build with the latest GitHub release'}
            </span>
          </div>
          <div className="settings-row-actions">
            <button
              type="button"
              className="btn-action"
              disabled={updateChecking}
              onClick={() => {
                if (!window.api?.checkForUpdates) {
                  setUpdateMsg('Available in the desktop app')
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
                        `Update available: ${r.latest} (you have ${r.current})`
                      )
                    } else {
                      setUpdateMsg(
                        `You’re up to date (${r.current})`
                      )
                    }
                  })
                  .catch((e) => {
                    console.warn('[system-settings]', e)
                    setUpdateMsg('Something failed — see the console for details.')
                  })
                  .finally(() => setUpdateChecking(false))
              }}
            >
              {updateChecking
                ? 'Checking…'
                : 'Check for updates'}
            </button>
            <button
              type="button"
              className="btn-action"
              disabled={updateChecking}
              onClick={() => {
                if (!window.api?.downloadUpdate) {
                  setUpdateMsg('Available in the desktop app')
                  return
                }
                setUpdateChecking(true)
                setUpdateMsg('Downloading installer…')
                void window.api
                  .downloadUpdate()
                  .then((r) => {
                    if (r.alreadyLatest) {
                      setUpdateMsg(
                        `You’re up to date (${r.current || ''})`
                      )
                      return
                    }
                    if (r.ok && r.path) {
                      setUpdateMsg(
                        `Installer opened: ${r.path}`
                      )
                    } else {
                      setUpdateMsg(r.error || 'Download failed')
                    }
                  })
                  .catch((e) => {
                    console.warn('[system-settings]', e)
                    setUpdateMsg('Something failed — see the console for details.')
                  })
                  .finally(() => setUpdateChecking(false))
              }}
            >
              {'Download & open'}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label settings-row-label-icon">
              <IconGitHub size={16} />
              {'GitHub'}
            </span>
            <span className="settings-row-desc">{'Source, releases, and issues'}</span>
          </div>
          <button
            type="button"
            className="btn-action btn-with-icon"
            onClick={() => {
              window.api?.browser?.open?.(REPO_URL)?.catch?.(() => {})
            }}
          >
            <IconGitHub size={14} />
            {'Open'}
          </button>
        </div>
      </div>
    </div>
  )
}
