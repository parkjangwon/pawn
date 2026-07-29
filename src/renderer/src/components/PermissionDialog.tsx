import { useTranslation } from 'react-i18next'
import { usePermissionStore } from '../stores/permission'
import './PermissionDialog.css'

export default function PermissionDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { pending, resolve } = usePermissionStore()

  if (pending.length === 0) return null

  const current = pending[0]

  const typeLabels: Record<string, string> = {
    computer_use: '{t("permission.types.computer_use")}',
    file_write: '{t("permission.types.file_write")}',
    shell_exec: '{t("permission.types.shell_exec")}',
    browser: '{t("permission.types.browser")}'
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
          <button className="allow-btn" onClick={() => resolve(current.id, true)}>
            {t("permission.allow")}
          </button>
        </div>
      </div>
    </div>
  )
}
