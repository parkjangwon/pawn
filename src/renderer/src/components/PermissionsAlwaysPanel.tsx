import { useTranslation } from 'react-i18next'
import { usePermissionStore, type AllowRule, type PermissionType } from '../stores/permission'
import './PermissionsAlwaysPanel.css'

function describeRule(
  rule: AllowRule,
  t: (k: string, o?: Record<string, string>) => string
): { title: string; detail: string } {
  if (rule.kind === 'perm_type') {
    return {
      title: t(`permission.types.${rule.type}` as never) || rule.type,
      detail: t('permission.alwaysRules.kindType')
    }
  }
  if (rule.kind === 'path_prefix') {
    return {
      title: t('permission.alwaysRules.pathTitle'),
      detail: rule.prefix
    }
  }
  return {
    title: t('permission.alwaysRules.shellTitle'),
    detail: rule.prefix
  }
}

export default function PermissionsAlwaysPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const alwaysRules = usePermissionStore((s) => s.alwaysRules)
  const sessionRules = usePermissionStore((s) => s.sessionRules)
  const sessionApproved = usePermissionStore((s) => s.sessionApproved)
  const removeRule = usePermissionStore((s) => s.removeRule)

  const sessionTypes = Array.from(sessionApproved) as PermissionType[]

  return (
    <div className="perm-always-panel">
      <div className="settings-row-info perm-always-head">
        <span className="settings-row-label">{t('permission.alwaysRules.title')}</span>
        <span className="settings-row-desc">{t('permission.alwaysRules.desc')}</span>
      </div>

      {alwaysRules.length === 0 ? (
        <div className="perm-always-empty">{t('permission.alwaysRules.empty')}</div>
      ) : (
        <ul className="perm-always-list">
          {alwaysRules.map((rule) => {
            const { title, detail } = describeRule(rule, t as never)
            return (
              <li key={rule.id} className="perm-always-item">
                <div className="perm-always-item-info">
                  <strong>{title}</strong>
                  <span className="perm-always-detail" title={detail}>
                    {detail}
                  </span>
                  <span className="perm-always-badge">{t('permission.alwaysRules.scopeAlways')}</span>
                </div>
                <button
                  type="button"
                  className="perm-always-remove"
                  onClick={() => removeRule(rule.id)}
                >
                  {t('permission.alwaysRules.remove')}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(sessionRules.length > 0 || sessionTypes.length > 0) && (
        <div className="perm-session-block">
          <div className="settings-row-label">{t('permission.alwaysRules.sessionTitle')}</div>
          <span className="settings-row-desc">{t('permission.alwaysRules.sessionDesc')}</span>
          <ul className="perm-always-list soft">
            {sessionTypes.map((type) => (
              <li key={`type-${type}`} className="perm-always-item">
                <div className="perm-always-item-info">
                  <strong>{t(`permission.types.${type}`)}</strong>
                  <span className="perm-always-badge">{t('permission.alwaysRules.scopeSession')}</span>
                </div>
              </li>
            ))}
            {sessionRules.map((rule) => {
              const { title, detail } = describeRule(rule, t as never)
              return (
                <li key={rule.id} className="perm-always-item">
                  <div className="perm-always-item-info">
                    <strong>{title}</strong>
                    <span className="perm-always-detail">{detail}</span>
                    <span className="perm-always-badge">{t('permission.alwaysRules.scopeSession')}</span>
                  </div>
                  <button
                    type="button"
                    className="perm-always-remove"
                    onClick={() => removeRule(rule.id)}
                  >
                    {t('permission.alwaysRules.remove')}
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
