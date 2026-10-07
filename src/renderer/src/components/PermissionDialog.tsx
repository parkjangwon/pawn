import { useEffect, useRef, useState } from 'react'
import { tx } from '../i18n'
import { usePermissionStore } from '../stores/permission'
import { useFocusTrap } from '../utils/focusTrap'
import './PermissionDialog.css'

export default function PermissionDialog(): React.JSX.Element | null {
  const { pending, resolve, approveSession, addRule } = usePermissionStore()
  const dialogRef = useRef<HTMLDivElement>(null)
  const open = pending.length > 0
  useFocusTrap(open, dialogRef, { initialFocus: '.allow-btn' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (pending.length === 0) return
    const currentId = pending[0]?.id
    if (!currentId) return
    const onKey = (e: KeyboardEvent): void => {
      // Re-read store so a rapid double-Escape cannot resolve a missing entry.
      const head = usePermissionStore.getState().pending[0]
      if (!head || head.id !== currentId) return
      if (e.key === 'Escape') {
        e.preventDefault()
        resolve(head.id, false)
        return
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        // Only primary allow when focus is not already on a secondary action
        const t = e.target as HTMLElement | null
        if (t?.closest('.session-btn') || t?.closest('.deny-btn')) return
        e.preventDefault()
        resolve(head.id, true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, resolve])

  if (pending.length === 0) return null

  const current = pending[0]

  const typeLabels: Record<string, string> = {
    computer_use: 'Use your computer',
    file_write: 'Save a file',
    file_read: 'Read a file',
    shell_exec: 'Run a command',
    browser: 'Use the browser',
    app: 'Change an app setting',
    mcp: 'Use a connected tool',
    network: 'Go online'
  }

  const pathPrefix = current.path
    ? current.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || current.path
    : undefined
  // First argv only — "git status" must not auto-allow all "git …" forever.
  const shellPrefix = current.command
    ? current.command.trim().split(/\s+/)[0]
    : undefined

  const hasSticky =
    Boolean(pathPrefix && current.type === 'file_write') ||
    Boolean(shellPrefix && current.type === 'shell_exec')

  return (
    <div className="permission-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <h3 id="permission-dialog-title">{'Permission request'}</h3>
        {pending.length > 1 && (
          <div className="permission-queue">
            {`${1} of ${pending.length} waiting`}
          </div>
        )}
        <div className="permission-type">{typeLabels[current.type] || current.type}</div>
        {current.risk ? (
          <div
            className={`permission-risk level-${current.risk.level}${current.risk.escalated ? ' escalated' : ''}`}
            role={current.risk.escalated ? 'alert' : undefined}
          >
            <span className="permission-risk-label">
              {`Decision model: ${tx(`permission.risk.levels.${current.risk.level}`)} (${Math.round(current.risk.probability * 100)}%)`}
            </span>
            {current.risk.sendsData >= 0.5 && (
              <span className="permission-risk-note">{'It may send local data to a remote server.'}</span>
            )}
            {current.risk.escalated && <span className="permission-risk-note">{'This would have run without asking. The decision model flagged it, so Pawn is checking with you.'}</span>}
          </div>
        ) : current.riskPending ? (
          <div className="permission-risk pending" aria-live="polite">
            {'Checking the risk…'}
          </div>
        ) : null}
        {/* Plain-language purpose (from the agent) replaces the tool label. */}
        {current.preview?.purpose ? (
          <p className="permission-purpose">{current.preview.purpose}</p>
        ) : (
          <p className="permission-desc">{current.description}</p>
        )}
        {current.preview ? (
          <div className={`permission-preview kind-${current.preview.kind}`}>
            <button
              type="button"
              className="permission-copy-btn"
              title={'Copy'}
              aria-label={'Copy'}
              onClick={() => {
                const text = current.preview
                  ? `${current.preview.target || ''}\n${current.preview.lines.map((l) => (current.preview!.kind === 'edit' && l.mark ? `${l.mark} ` : '') + l.text).join('\n')}`
                  : (current.details || current.command || '')
                navigator.clipboard.writeText(text).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                }).catch(() => {})
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {(current.preview.target || current.preview.summary) && (
              <div className="permission-preview-head">
                {current.preview.target && (
                  <code className="permission-preview-target" title={current.preview.target}>
                    {current.preview.target}
                  </code>
                )}
                {current.preview.summary && <span className="permission-preview-summary">{current.preview.summary}</span>}
              </div>
            )}
            {current.preview.lines.length > 0 && (
              <pre className="permission-details" aria-label={'What will change'}>
                {current.preview.lines.map((l, i) => (
                  <span key={i} className={`pp-line${l.mark === '+' ? ' add' : l.mark === '-' ? ' del' : ''}`}>
                    {current.preview!.kind === 'edit' && l.mark ? `${l.mark} ` : ''}
                    {l.text || ' '}
                    {'\n'}
                  </span>
                ))}
                {current.preview.truncated ? (
                  <span className="pp-more">{(current.preview.truncated === 1 ? `… ${current.preview.truncated} more line` : `… ${current.preview.truncated} more lines`)}</span>
                ) : null}
              </pre>
            )}
          </div>
        ) : (
          current.details && <pre className="permission-details">{current.details}</pre>
        )}

        <div className="permission-kbd-hint" aria-hidden="true">
          {'Enter to allow · Esc to deny'}
        </div>
        <div className="permission-actions">
          <div className="permission-actions-secondary">
            <button
              type="button"
              className="session-btn"
              title={'Approve every request of this type until the app restarts'}
              onClick={() => {
                approveSession(current.type)
                resolve(current.id, true)
              }}
            >
              {'Allow until I quit'}
              <span className="permission-scope-note">{'Applies in every chat until Pawn restarts.'}</span>
            </button>
            {pathPrefix && current.type === 'file_write' && (
              <button
                type="button"
                className="session-btn"
                title={pathPrefix}
                onClick={() => {
                  addRule({ kind: 'path_prefix', prefix: pathPrefix, scope: 'always' })
                  resolve(current.id, true)
                }}
              >
                {'Always allow this folder'}
              </button>
            )}
            {shellPrefix && current.type === 'shell_exec' && (
              <button
                type="button"
                className="session-btn"
                title={'Approve every request of this type until the app restarts'}
                onClick={() => {
                  addRule({ kind: 'shell_prefix', prefix: shellPrefix, scope: 'always' })
                  resolve(current.id, true)
                }}
              >
                {`Always allow “${shellPrefix}”`}
              </button>
            )}
          </div>

          <div className={`permission-actions-primary${hasSticky ? ' has-secondary' : ''}`}>
            <button type="button" className="deny-btn" onClick={() => resolve(current.id, false)}>
              {'Deny'}
            </button>
            <button type="button" className="allow-btn" onClick={() => resolve(current.id, true)}>
              {'Allow'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
