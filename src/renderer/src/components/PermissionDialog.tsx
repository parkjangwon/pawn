import { usePermissionStore } from '../stores/permission'
import './PermissionDialog.css'

export default function PermissionDialog(): React.JSX.Element | null {
  const { pending, resolve } = usePermissionStore()

  if (pending.length === 0) return null

  const current = pending[0]

  const typeLabels: Record<string, string> = {
    computer_use: 'Computer Control',
    file_write: 'File Write',
    shell_exec: 'Shell Command',
    browser: 'Browser Access'
  }

  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <h3>Permission Required</h3>
        <div className="permission-type">{typeLabels[current.type] || current.type}</div>
        <p className="permission-desc">{current.description}</p>
        {current.details && <pre className="permission-details">{current.details}</pre>}
        <div className="permission-actions">
          <button className="deny-btn" onClick={() => resolve(current.id, false)}>
            Deny
          </button>
          <button className="allow-btn" onClick={() => resolve(current.id, true)}>
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
