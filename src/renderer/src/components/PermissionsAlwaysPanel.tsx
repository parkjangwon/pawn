import { tx } from '../i18n'
import { usePermissionStore, type AllowRule, type PermissionType } from '../stores/permission'
import './PermissionsAlwaysPanel.css'

function describeRule(
  rule: AllowRule,
): { title: string; detail: string } {
  if (rule.kind === 'perm_type') {
    return {
      title: tx(`permission.types.${rule.type}` as never) || rule.type,
      detail: 'Entire permission type'
    }
  }
  if (rule.kind === 'path_prefix') {
    return {
      title: 'Folder path',
      detail: rule.prefix
    }
  }
  return {
    title: 'Shell command prefix',
    detail: rule.prefix
  }
}

export default function PermissionsAlwaysPanel(): React.JSX.Element {
  const alwaysRules = usePermissionStore((s) => s.alwaysRules)
  const sessionRules = usePermissionStore((s) => s.sessionRules)
  const sessionApproved = usePermissionStore((s) => s.sessionApproved)
  const removeRule = usePermissionStore((s) => s.removeRule)

  const sessionTypes = Array.from(sessionApproved) as PermissionType[]

  return (
    <div className="perm-always-panel">
      <div className="settings-row-info perm-always-head">
        <span className="settings-row-label">{'Always-allow rules'}</span>
        <span className="settings-row-desc">{'Actions approved forever for this device. Remove a rule anytime — the next request will ask again.'}</span>
      </div>

      {alwaysRules.length === 0 ? (
        <div className="perm-always-empty">{'No always-allow rules yet. Approve with “Always allow…” on a permission prompt.'}</div>
      ) : (
        <ul className="perm-always-list">
          {alwaysRules.map((rule) => {
            const { title, detail } = describeRule(rule)
            return (
              <li key={rule.id} className="perm-always-item">
                <div className="perm-always-item-info">
                  <strong>{title}</strong>
                  <span className="perm-always-detail" title={detail}>
                    {detail}
                  </span>
                  <span className="perm-always-badge">{'Always'}</span>
                </div>
                <button
                  type="button"
                  className="perm-always-remove"
                  onClick={() => removeRule(rule.id)}
                >
                  {'Remove'}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(sessionRules.length > 0 || sessionTypes.length > 0) && (
        <div className="perm-session-block">
          <div className="settings-row-label">{'Temporary approvals'}</div>
          <span className="settings-row-desc">{'Cleared when you quit the app.'}</span>
          <ul className="perm-always-list soft">
            {sessionTypes.map((type) => (
              <li key={`type-${type}`} className="perm-always-item">
                <div className="perm-always-item-info">
                  <strong>{tx(`permission.types.${type}`)}</strong>
                  <span className="perm-always-badge">{'Until quit'}</span>
                </div>
              </li>
            ))}
            {sessionRules.map((rule) => {
              const { title, detail } = describeRule(rule)
              return (
                <li key={rule.id} className="perm-always-item">
                  <div className="perm-always-item-info">
                    <strong>{title}</strong>
                    <span className="perm-always-detail">{detail}</span>
                    <span className="perm-always-badge">{'Until quit'}</span>
                  </div>
                  <button
                    type="button"
                    className="perm-always-remove"
                    onClick={() => removeRule(rule.id)}
                  >
                    {'Remove'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
