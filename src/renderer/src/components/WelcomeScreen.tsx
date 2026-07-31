import { useTranslation } from 'react-i18next'

export interface WelcomeSuggestion {
  icon: string
  text: string
}

interface WelcomeScreenProps {
  activeProject: { name: string } | undefined
  suggestions: WelcomeSuggestion[]
  onPick: (text: string) => void
}

export default function WelcomeScreen({ activeProject, suggestions, onPick }: WelcomeScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
        <div className="chat-welcome">
          <div className="welcome-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1>{activeProject ? t('chat.welcomeProject', { name: activeProject.name }) : t('chat.welcome')}</h1>
          {!activeProject && <p>{t('chat.welcomeSub')}</p>}
          <div className="welcome-actions">
            {suggestions.map((s, i) => (
              <button key={i} className="welcome-btn" onClick={() => { onPick(s.text) }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {s.icon === 'code' && <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>}
                  {s.icon === 'globe' && <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>}
                  {s.icon === 'file' && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>}
                  {s.icon === 'calendar' && <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>}
                  {s.icon === 'monitor' && <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>}
                  {s.icon === 'edit' && <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>}
                </svg>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
        </div>
  )
}
