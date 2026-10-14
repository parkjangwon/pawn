import { DEFAULT_KEYBINDINGS, KEYBINDING_IDS, formatCombo, formatComboKeys } from '../stores/keybindings'
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
        <button type="button" className="settings-btn-secondary test-btn" onClick={() => window.dispatchEvent(new CustomEvent('pawn:shortcuts-help'))}>
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
                      : keybindings[id] ? <ShortcutKeys combo={keybindings[id]} /> : <span className="shortcut-unset">{'Not set'}</span>}
                </span>
              </div>
              <div className="settings-row-actions">
                <button className={`settings-btn-secondary test-btn ${recording === id ? 'ok' : ''}`} onClick={() => setRecording(recording === id ? null : id)}>
                  {recording === id ? 'Cancel' : 'Change'}
                </button>
                <button
                  className="settings-btn-secondary test-btn"
                  onClick={() => setKeybinding(id, '')}
                  disabled={!keybindings[id]}
                  title={'Not set'}
                >
                  {'Clear'}
                </button>
                <button className="settings-btn-secondary test-btn" onClick={() => resetKeybinding(id)} disabled={keybindings[id] === DEFAULT_KEYBINDINGS[id]}>
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

/** A combo as keycaps (⌥ ⌘ B). The full string stays available to screen readers. */
export function ShortcutKeys({ combo }: { combo: string }): React.JSX.Element {
  return (
    <span className="shortcut-combo" aria-label={formatCombo(combo)}>
      {formatComboKeys(combo).map((k, i) => (
        <kbd key={i} className="shortcut-kbd" aria-hidden="true">{k}</kbd>
      ))}
    </span>
  )
}
