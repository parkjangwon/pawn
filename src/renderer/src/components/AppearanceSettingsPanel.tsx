import type { SettingsState } from './settingsState'

export default function AppearanceSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const { t, i18n, theme, set, languages } = state

  return (
    <div className="settings-section settings-section-animate">
      <h2>{t('settings.appearanceSection.title')}</h2>
      <p className="settings-desc">{t('settings.appearanceSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.appearanceSection.theme')}</span>
            <span className="settings-row-desc">{t('settings.appearanceSection.themeDesc')}</span>
          </div>
          <div className="theme-segmented-control">
            <button
              type="button"
              className={`theme-segment-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => set('light')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              <span>{t('theme.light')}</span>
            </button>
            <button
              type="button"
              className={`theme-segment-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => set('dark')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <span>{t('theme.dark')}</span>
            </button>
            <button
              type="button"
              className={`theme-segment-btn ${theme === 'system' ? 'active' : ''}`}
              onClick={() => set('system')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span>{t('theme.system')}</span>
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.appearanceSection.language')}</span>
            <span className="settings-row-desc">{t('settings.appearanceSection.languageDesc')}</span>
          </div>
          <select
            className="settings-select"
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
