import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx } from '../i18n'
import { deriveModCapabilities, deriveModRisk } from '../agent/mods'
import { useEffectiveTheme } from '../stores/theme'
import { useFocusTrap } from '../utils/focusTrap'
import Button from './Button'
import './ConfirmDialog.css'
import './ModsSettingsPanel.css'

export interface ModsConsentPreview {
  name: string
  version: string
  ok: boolean
  hooks: string[]
  calls: string[]
  findings: Array<{ severity: string; message: string }>
}

export default function ModsConsentDialog({
  preview,
  onCancel,
  onConfirm
}: {
  preview: ModsConsentPreview
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const theme = useEffectiveTheme()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Opening another mod replaces preview without unmounting.
  useEffect(() => {
    setShowAdvanced(false)
  }, [preview])
  useFocusTrap(true, dialogRef, { initialFocus: '.confirm-actions .pawn-btn-outline' })

  const capabilities = useMemo(
    () => deriveModCapabilities(preview.hooks, preview.calls),
    [preview.hooks, preview.calls]
  )
  const risk = useMemo(
    () => deriveModRisk(preview.hooks, preview.calls),
    [preview.hooks, preview.calls]
  )

  return createPortal(
    <div className={`app ${theme}`}>
      <div
        className="confirm-overlay"
        role="presentation"
        onClick={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <div
          ref={dialogRef}
          className="confirm-dialog mods-consent-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mods-consent-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="mods-consent-title">{`Allow “${preview.name}”?`}</h3>
          <p>{'This mod runs in-process with your account permissions. Check what it hooks before allowing.'}</p>
          <div className="mods-consent-meta">
            <span className="mods-version">{`Version ${preview.version}`}</span>
            <span className={`mods-risk mods-risk-${risk}`}>{tx(`settings.modsSection.risk.${risk}`)}</span>
          </div>
          {capabilities.length === 0 ? (
            <span className="mods-cap-empty">{'No special capabilities detected'}</span>
          ) : (
            <ul className="mods-cap-list" role="list">
              {capabilities.map((cap) => (
                <li key={cap.id} className="mods-cap-row" data-cap={cap.id}>
                  <span className="mods-cap-label">{tx(cap.labelKey)}</span>
                  <span className="mods-cap-desc">{tx(cap.descKey)}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="mods-advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {'Show technical hooks & calls'}
          </button>
          {showAdvanced && (
            <>
              <div className="mods-consent-block">
                <span className="mods-consent-label">{'Events it listens for'}</span>
                <code>{preview.hooks.join(', ') || '—'}</code>
              </div>
              <div className="mods-consent-block">
                <span className="mods-consent-label">{'APIs it may call'}</span>
                <code>{preview.calls.join(', ') || '—'}</code>
              </div>
            </>
          )}
          {preview.findings.length > 0 && (
            <ul className="mods-consent-findings">
              {preview.findings.map((f, i) => (
                <li key={i} className={f.severity}>
                  {f.message}
                </li>
              ))}
            </ul>
          )}
          <p className="mods-consent-warn">{'You can turn it off later. Untrusted code can read files and run commands.'}</p>
          <div className="confirm-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              {'Cancel'}
            </Button>
            <Button type="button" variant="default" disabled={!preview.ok} onClick={onConfirm}>
              {'Allow and enable'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
