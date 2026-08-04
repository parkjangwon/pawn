import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissionStore } from '../stores/permission'
import './PermissionDialog.css'

export default function PermissionDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { pending, resolve, approveSession } = usePermissionStore()

  // Escape denies the current request so a stuck dialog can always be dismissed
  // without letting the agent wait forever.
  useEffect(() => {
    if (pending.length === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') resolve(pending[0].id, false)
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

  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <h3>{t("permission.title")}</h3>
        <div className="permission-type">{typeLabels[current.type] || current.type}</div>
        <p className="permission-desc">{current.description}</p>
        {current.details && <pre className="permission-details">{current.details}</pre>}
        <div className="permission-actions">
          <button className="deny-btn" onClick={() => resolve(current.id, false)}>
            {t("permission.deny")}
          </button>
          <button
            className="session-btn"
            title={t('permission.allowSessionHint')}
            onClick={() => { approveSession(current.type); resolve(current.id, true) }}
          >
            {t("permission.allowSession")}
          </button>
          <button className="allow-btn" onClick={() => resolve(current.id, true)}>
            {t("permission.allow")}
          </button>
        </div>
      </div>
    </div>
  )
}
