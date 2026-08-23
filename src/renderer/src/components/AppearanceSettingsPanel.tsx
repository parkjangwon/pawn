import type { SettingsState } from './settingsState'

export default function AppearanceSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const { t, i18n, theme, set, languages } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.appearanceSection.title')}</h2>
      <p className="settings-desc">{t('settings.appearanceSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.appearanceSection.theme')}</span>
            <span className="settings-row-desc">{t('settings.appearanceSection.themeDesc')}</span>
          </div>
          <div className="theme-toggle">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>{t('theme.light')}</button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>{t('theme.dark')}</button>
            <button className={theme === 'system' ? 'active' : ''} onClick={() => set('system')}>{t('theme.system')}</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.appearanceSection.language')}</span>
            <span className="settings-row-desc">{t('settings.appearanceSection.languageDesc')}</span>
          </div>
          <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
