import { Monitor, Moon, Sun } from 'lucide-react'
import type { SettingsState } from './settingsState'
import { CHAT_FONT_SIZES, DEFAULT_CHAT_FONT_SIZE, usePrefsStore } from '../stores/prefs'

export default function AppearanceSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const { t, i18n, theme, set, languages } = state
  const chatFontSize = usePrefsStore((s) => s.chatFontSize)
  const setChatFontSize = usePrefsStore((s) => s.setChatFontSize)

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
          <div
            className="theme-segmented-control"
            role="radiogroup"
            aria-label={t('settings.appearanceSection.theme')}
          >
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'light'}
              className={`theme-segment-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => set('light')}
            >
              <Sun size={14} />
              <span>{t('theme.light')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'dark'}
              className={`theme-segment-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => set('dark')}
            >
              <Moon size={14} />
              <span>{t('theme.dark')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'system'}
              className={`theme-segment-btn ${theme === 'system' ? 'active' : ''}`}
              onClick={() => set('system')}
            >
              <Monitor size={14} />
              <span>{t('theme.system')}</span>
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.appearanceSection.chatFontSize')}</span>
            <span className="settings-row-desc">{t('settings.appearanceSection.chatFontSizeDesc')}</span>
          </div>
          <div
            className="theme-segmented-control font-size-control"
            role="radiogroup"
            aria-label={t('settings.appearanceSection.chatFontSize')}
          >
            {CHAT_FONT_SIZES.map((px) => (
              <button
                key={px}
                type="button"
                role="radio"
                aria-checked={chatFontSize === px}
                className={`theme-segment-btn ${chatFontSize === px ? 'active' : ''}`}
                onClick={() => setChatFontSize(px)}
                title={px === DEFAULT_CHAT_FONT_SIZE ? t('settings.appearanceSection.chatFontSizeDefault') : `${px}px`}
              >
                <span style={{ fontSize: `${Math.max(11, px - 2)}px`, fontWeight: 600 }} aria-hidden>
                  A
                </span>
                <span>{px}</span>
              </button>
            ))}
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
