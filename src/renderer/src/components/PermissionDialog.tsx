import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissionStore } from '../stores/permission'
import './PermissionDialog.css'

export default function PermissionDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { pending, resolve, approveSession, addRule } = usePermissionStore()

  useEffect(() => {
    if (pending.length === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') resolve(pending[0].id, false)
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        e.preventDefault()
        resolve(pending[0].id, true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, resolve])

  if (pending.length === 0) return null

  const current = pending[0]

  const typeLabels: Record<string, string> = {
    computer_use: t('permission.types.computer_use'),
    file_write: t('permission.types.file_write'),
    file_read: t('permission.types.file_read'),
    shell_exec: t('permission.types.shell_exec'),
    browser: t('permission.types.browser'),
    app: t('permission.types.app'),
    mcp: t('permission.types.mcp')
  }

  const pathPrefix = current.path
    ? current.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || current.path
    : undefined
  const shellPrefix = current.command
    ? current.command.trim().split(/\s+/).slice(0, 2).join(' ')
    : undefined

  const hasSticky =
    Boolean(pathPrefix && current.type === 'file_write') ||
    Boolean(shellPrefix && current.type === 'shell_exec')

  return (
    <div className="permission-overlay" role="presentation">
      <div
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <h3 id="permission-dialog-title">{t('permission.title')}</h3>
        <div className="permission-type">{typeLabels[current.type] || current.type}</div>
        <p className="permission-desc">{current.description}</p>
        {current.details && <pre className="permission-details">{current.details}</pre>}

        <div className="permission-actions">
          <div className="permission-actions-secondary">
            <button
              type="button"
              className="session-btn"
              title={t('permission.allowSessionHint')}
              onClick={() => {
                approveSession(current.type)
                resolve(current.id, true)
              }}
            >
              {t('permission.allowSession')}
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
                {t('permission.allowPathAlways')}
              </button>
            )}
            {shellPrefix && current.type === 'shell_exec' && (
              <button
                type="button"
                className="session-btn"
                title={shellPrefix}
                onClick={() => {
                  addRule({ kind: 'shell_prefix', prefix: shellPrefix, scope: 'always' })
                  resolve(current.id, true)
                }}
              >
                {t('permission.allowShellAlways')}
              </button>
            )}
          </div>

          <div className={`permission-actions-primary${hasSticky ? ' has-secondary' : ''}`}>
            <button type="button" className="deny-btn" onClick={() => resolve(current.id, false)}>
              {t('permission.deny')}
            </button>
            <button type="button" className="allow-btn" onClick={() => resolve(current.id, true)}>
              {t('permission.allow')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
