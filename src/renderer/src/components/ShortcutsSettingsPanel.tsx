import { DEFAULT_KEYBINDINGS, KEYBINDING_IDS, formatCombo } from '../stores/keybindings'
import type { SettingsState } from './settingsState'

export default function ShortcutsSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    comboConflict,
    shortcutLabel,
    recording,
    setRecording,
    keybindings,
    resetKeybinding
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.shortcutSection.title')}</h2>
      <p className="settings-desc">{t('settings.shortcutSection.desc')}</p>
      <div className="settings-card">
        {KEYBINDING_IDS.map((id) => {
          const conflict = comboConflict(id)
          return (
            <div key={id} className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{shortcutLabel(id)}</span>
                <span className="settings-row-desc">
                  {recording === id
                    ? t('settings.shortcutSection.recording')
                    : conflict
                      ? t('settings.shortcutSection.conflict', { other: shortcutLabel(conflict) })
                      : keybindings[id] ? formatCombo(keybindings[id]) : t('settings.shortcutSection.none')}
                </span>
              </div>
              <div className="settings-row-actions">
                <button className={`test-btn ${recording === id ? 'ok' : ''}`} onClick={() => setRecording(recording === id ? null : id)}>
                  {recording === id ? t('settings.shortcutSection.cancel') : t('settings.shortcutSection.change')}
                </button>
                <button className="test-btn" onClick={() => resetKeybinding(id)} disabled={keybindings[id] === DEFAULT_KEYBINDINGS[id]}>
                  {t('settings.shortcutSection.reset')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
