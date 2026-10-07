import { DEFAULT_KEYBINDINGS, KEYBINDING_IDS, formatCombo } from '../stores/keybindings'
import type { SettingsState } from './settingsState'

export default function ShortcutsSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    comboConflict,
    shortcutLabel,
    recording,
    setRecording,
    keybindings,
    setKeybinding,
    resetKeybinding
  } = state

  return (
    <div className="settings-section">
      <h2>{'Shortcuts'}</h2>
      <p className="settings-desc">{'Rebind keyboard shortcuts. Click Change, then press the new combination.'}</p>
      <div>
        <button type="button" className="test-btn" onClick={() => window.dispatchEvent(new CustomEvent('pawn:shortcuts-help'))}>
          {'View all shortcuts'}
        </button>
      </div>
      <div className="settings-card">
        {KEYBINDING_IDS.map((id) => {
          const conflict = comboConflict(id)
          return (
            <div key={id} className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{shortcutLabel(id)}</span>
                <span className="settings-row-desc">
                  {recording === id
                    ? 'Press new shortcut… (Esc to cancel)'
                    : conflict
                      ? `Conflicts with ${shortcutLabel(conflict)}`
                      : keybindings[id] ? formatCombo(keybindings[id]) : 'Not set'}
                </span>
              </div>
              <div className="settings-row-actions">
                <button className={`test-btn ${recording === id ? 'ok' : ''}`} onClick={() => setRecording(recording === id ? null : id)}>
                  {recording === id ? 'Cancel' : 'Change'}
                </button>
                <button
                  className="test-btn"
                  onClick={() => setKeybinding(id, '')}
                  disabled={!keybindings[id]}
                  title={'Not set'}
                >
                  {'Clear'}
                </button>
                <button className="test-btn" onClick={() => resetKeybinding(id)} disabled={keybindings[id] === DEFAULT_KEYBINDINGS[id]}>
                  {'Reset'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
