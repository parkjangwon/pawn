import { skillSummary } from '../agent/skills'
import { isSkillEnabled } from '../utils/skillVisibility'
import type { SettingsSkillScope } from './settingsMeta'
import type { SettingsState } from './settingsState'

export default function PluginsSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    contextAdditionCount,
    enabledSkillCount,
    loadedSkills,
    contextSignals,
    skillScope,
    setSkillScope,
    scopeCounts,
    skillSearch,
    setSkillSearch,
    skillsLoading,
    visibleSkills,
    disabledSkills,
    toggleSkill
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.pluginSection.title')}</h2>
      <p className="settings-desc">{t('settings.pluginSection.desc')}</p>
      <div className="settings-card">
        <div className="plugin-context-head">
          <span className="settings-row-label">{t('settings.pluginSection.contextTitle')}</span>
          <span className="settings-row-desc">
            {t('settings.pluginSection.contextApplied', {
              blocks: contextAdditionCount,
              enabled: enabledSkillCount,
              total: loadedSkills.length
            })}
          </span>
        </div>
        <div className="plugin-context-list">
          {contextSignals.map((signal) => (
            <div key={signal.id} className="plugin-context-item">
              <div className="plugin-context-main">
                <span className="plugin-context-label">{t(`settings.pluginSection.sources.${signal.id}`)}</span>
                <span className="plugin-context-path">{signal.path || t('settings.pluginSection.noProjectPath')}</span>
              </div>
              <span className={`plugin-context-status ${signal.detected ? 'ok' : 'off'}`}>
                {signal.detected ? t('settings.pluginSection.detected') : t('settings.pluginSection.missing')}
                {signal.details ? ` (${signal.details})` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="plugin-toolbar">
          <div className="plugin-scope-toggle" role="tablist" aria-label={t('settings.pluginSection.scopeLabel')}>
            {(['all', 'project', 'device', 'builtin'] as SettingsSkillScope[]).map((scope) => (
              <button
                key={scope}
                role="tab"
                aria-selected={skillScope === scope}
                className={`plugin-scope-btn ${skillScope === scope ? 'active' : ''}`}
                onClick={() => setSkillScope(scope)}
              >
                {t(`settings.pluginSection.scope.${scope}`)} ({scopeCounts[scope]})
              </button>
            ))}
          </div>
          <input
            className="plugin-search-input"
            value={skillSearch}
            onChange={(e) => setSkillSearch(e.target.value)}
            placeholder={t('settings.pluginSection.searchPlaceholder')}
          />
        </div>
        {skillsLoading && <div className="settings-empty">{t('common.loading')}</div>}
        {!skillsLoading && visibleSkills.length === 0 && <div className="settings-empty">{t('settings.pluginSection.emptySkills')}</div>}
        {!skillsLoading && visibleSkills.map((skill) => {
          const enabled = isSkillEnabled(skill.name, disabledSkills)
          return (
            <div key={`${skill.kind}:${skill.source}`} className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">
                  {skill.name}
                  <span className="plugin-kind">{t(`settings.pluginSection.kind.${skill.kind}`)}</span>
                </span>
                <span className="settings-row-desc">{skillSummary(skill) || skill.source}</span>
                <span className="plugin-source">{skill.source}</span>
              </div>
              <div className="settings-row-actions">
                <label className="toggle-switch">
                  <input type="checkbox" checked={enabled} onChange={() => toggleSkill(skill.name)} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
