import { useEffect, useRef, useState } from 'react'
import { tx } from '../i18n'
import { KEYBINDING_IDS, useKeybindingsStore, formatCombo } from '../stores/keybindings'
import { useModalDialog } from '../utils/focusTrap'
import './ShortcutsHelp.css'

export const SHORTCUTS_HELP_EVENT = 'pawn:shortcuts-help'

/** Open the keyboard-shortcuts cheat sheet from anywhere in the renderer. */
export function openShortcutsHelp(): void {
  window.dispatchEvent(new CustomEvent(SHORTCUTS_HELP_EVENT))
}

/**
 * Modal cheat sheet of every keyboard shortcut: the rebindable set (live from
 * the keybindings store) plus fixed single-key behaviours. Opened from the
 * command palette, the Shortcuts settings panel, or the pawn:shortcuts-help
 * event.
 */
export default function ShortcutsHelp(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const bindings = useKeybindingsStore((s) => s.bindings)
  useModalDialog(open, dialogRef, () => setOpen(false), { initialFocus: '.shortcuts-close' })

  useEffect(() => {
    const onOpen = (): void => setOpen(true)
    window.addEventListener(SHORTCUTS_HELP_EVENT, onOpen)
    return () => window.removeEventListener(SHORTCUTS_HELP_EVENT, onOpen)
  }, [])

  if (!open) return null

  return (
    <div className="shortcuts-overlay" onClick={() => setOpen(false)} role="presentation">
      <div
        ref={dialogRef}
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={'Keyboard shortcuts'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-head">
          <h3>{'Keyboard shortcuts'}</h3>
          <button type="button" className="shortcuts-close" onClick={() => setOpen(false)} aria-label={'Cancel'}>
            ×
          </button>
        </div>
        <div className="shortcuts-grid">
          {KEYBINDING_IDS.map((id) => (
            <div key={id} className="shortcuts-row">
              <span className="shortcuts-label">{tx(`settings.shortcutSection.${id}`)}</span>
              <kbd className="shortcuts-kbd">{bindings[id] ? formatCombo(bindings[id]) : '—'}</kbd>
            </div>
          ))}
        </div>
        <div className="shortcuts-fixed">
          <div className="shortcuts-group-label">{'Fixed shortcuts'}</div>
          <div className="shortcuts-row">
            <span className="shortcuts-label">{'Find in chat'}</span>
            <kbd className="shortcuts-kbd">⌘F</kbd>
          </div>
          <div className="shortcuts-row">
            <span className="shortcuts-label">{'Interrupt the agent'}</span>
            <kbd className="shortcuts-kbd">Esc</kbd>
          </div>
          <div className="shortcuts-row">
            <span className="shortcuts-label">{'Enter to allow · Esc to deny'}</span>
            <kbd className="shortcuts-kbd">⏎ / Esc</kbd>
          </div>
          <div className="shortcuts-row">
            <span className="shortcuts-label">{'Navigate'}</span>
            <kbd className="shortcuts-kbd">↑ ↓ · ↵ · Esc</kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
