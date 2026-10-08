import { Monitor, Moon, Sun } from 'lucide-react'
import type { SettingsState } from './settingsState'
import { CHAT_FONT_SIZES, DEFAULT_CHAT_FONT_SIZE, usePrefsStore } from '../stores/prefs'

export default function AppearanceSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const { theme, set } = state
  const chatFontSize = usePrefsStore((s) => s.chatFontSize)
  const setChatFontSize = usePrefsStore((s) => s.setChatFontSize)

  return (
    <div className="settings-section settings-section-animate">
      <h2>{'Appearance'}</h2>
      <p className="settings-desc">{'Customize how Pawn looks and feels'}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Theme'}</span>
            <span className="settings-row-desc">{'Choose between light, dark, or system theme'}</span>
          </div>
          <div
            className="theme-segmented-control"
            role="radiogroup"
            aria-label={'Theme'}
          >
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'system'}
              className={`theme-segment-btn ${theme === 'system' ? 'active' : ''}`}
              onClick={() => set('system')}
            >
              <Monitor size={14} />
              <span>{'System'}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'light'}
              className={`theme-segment-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => set('light')}
            >
              <Sun size={14} />
              <span>{'Light'}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'dark'}
              className={`theme-segment-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => set('dark')}
            >
              <Moon size={14} />
              <span>{'Dark'}</span>
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Message text size'}</span>
            <span className="settings-row-desc">{'Size of chat message text and code. The rest of the interface stays the same.'}</span>
          </div>
          <div
            className="theme-segmented-control font-size-control"
            role="radiogroup"
            aria-label={'Message text size'}
          >
            {CHAT_FONT_SIZES.map((px) => (
              <button
                key={px}
                type="button"
                role="radio"
                aria-checked={chatFontSize === px}
                className={`theme-segment-btn ${chatFontSize === px ? 'active' : ''}`}
                onClick={() => setChatFontSize(px)}
                title={px === DEFAULT_CHAT_FONT_SIZE ? 'Default (14px)' : `${px}px`}
              >
                <span style={{ fontSize: `${Math.max(11, px - 2)}px`, fontWeight: 600 }} aria-hidden>
                  A
                </span>
                <span>{px}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
