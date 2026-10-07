import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, Code, Globe, Monitor } from 'lucide-react'
import { useProviderStore } from '../stores/provider'
import { openPluginsExtensions, __providerTestOutcome } from './settingsState'

interface WelcomeScreenProps {
  activeProject: { name: string; path?: string } | undefined
  onPick: (text: string) => void
  /** The chat composer, rendered prominent directly under the greeting. */
  composer: ReactNode
}

/** Local hour -> one of the six greeting segments. */
export function getGreetingKey(hour: number): string {
  if (hour >= 5 && hour < 7) return 'chat.greeting.dawn'
  if (hour >= 7 && hour < 11) return 'chat.greeting.morning'
  if (hour >= 11 && hour < 14) return 'chat.greeting.midday'
  if (hour >= 14 && hour < 18) return 'chat.greeting.afternoon'
  if (hour >= 18 && hour < 23) return 'chat.greeting.evening'
  return 'chat.greeting.night'
}

type HomeCard = {
  id: string
  icon: 'code' | 'globe' | 'monitor' | 'calendar'
  titleKey: string
  descKey: string
  promptKey: string
}

const HOME_CARDS: HomeCard[] = [
  { id: 'code', icon: 'code', titleKey: 'chat.home.codeTitle', descKey: 'chat.home.codeDesc', promptKey: 'chat.suggestions.fixFailingTests' },
  { id: 'browse', icon: 'globe', titleKey: 'chat.home.browseTitle', descKey: 'chat.home.browseDesc', promptKey: 'chat.suggestions.researchCompare' },
  { id: 'computer', icon: 'monitor', titleKey: 'chat.home.computerTitle', descKey: 'chat.home.computerDesc', promptKey: 'chat.suggestions.screenshot' },
  { id: 'auto', icon: 'calendar', titleKey: 'chat.home.autoTitle', descKey: 'chat.home.autoDesc', promptKey: 'chat.suggestions.setupAutomation' }
]

function CardIcon({ icon }: { icon: HomeCard['icon'] }): React.JSX.Element {
  if (icon === 'code') return <Code size={16} aria-hidden="true" />
  if (icon === 'globe') return <Globe size={16} aria-hidden="true" />
  if (icon === 'monitor') return <Monitor size={16} aria-hidden="true" />
  return <Calendar size={16} aria-hidden="true" />
}

export default function WelcomeScreen({
  activeProject,
  onPick,
  composer
}: WelcomeScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const providers = useProviderStore((s) => s.providers)
  // "Add a key" is only done when a working provider exists: enabled, with a
  // credential (or a sign-in format that needs none), and not failed by the
  // auto-test that runs right after a preset is added.
  const providerReady = providers.some(
    (p) =>
      p.enabled &&
      __providerTestOutcome[p.id] !== 'fail' &&
      (p.apiKey || p.apiFormat === 'kiro')
  )

  const [hour, setHour] = useState(() => new Date().getHours())

  useEffect(() => {
    const timer = setInterval(() => { setHour(new Date().getHours()) }, 60000)
    return () => { clearInterval(timer) }
  }, [])

  const [hasExtension, setHasExtension] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api?.mods
      ?.list(null)
      .then((res) => {
        if (!cancelled) setHasExtension(Boolean(res?.mods?.some((m) => m.enabled || m.consented)))
      })
      .catch(() => {
        if (!cancelled) setHasExtension(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="chat-welcome">
      <div className="welcome-hero">
        <div className="welcome-logo" aria-hidden="true">
          <svg width="120" height="120" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="6.5" r="2.7" />
            <rect x="8.6" y="9.9" width="6.8" height="1.7" rx="0.85" />
            <path d="M10.1 12.4h3.8l1.3 5.1H8.8l1.3-5.1z" />
            <rect x="7.2" y="17.5" width="9.6" height="2" rx="1" />
          </svg>
        </div>
        <h1 className="welcome-greeting">{t(getGreetingKey(hour))}</h1>
        <p className="welcome-sub">
          {activeProject
            ? t('chat.welcomeProject', { name: activeProject.name })
            : t('chat.welcomeSub')}
        </p>
      </div>

      <div className="welcome-composer">{composer}</div>

      {providerReady && !hasExtension && (
        <div className="welcome-mod-cta">
          <p>{t('chat.mods.welcomeHint')}</p>
          <button
            type="button"
            className="welcome-mod-cta-btn"
            onClick={() => openPluginsExtensions()}
          >
            {t('chat.mods.welcomeCta')}
          </button>
        </div>
      )}

      <div className="welcome-actions">
        {HOME_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="welcome-btn"
            aria-label={t(card.titleKey)}
            onClick={() => { onPick(t(card.promptKey)) }}
          >
            <span className="welcome-btn-icon" aria-hidden="true">
              <CardIcon icon={card.icon} />
            </span>
            <span className="welcome-btn-text">
              <span className="welcome-btn-title">{t(card.titleKey)}</span>
              <span className="welcome-btn-desc">{t(card.descKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
