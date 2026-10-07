import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useAppStore } from '../stores/app'
import { openSettingsSection, openPluginsExtensions, __providerTestOutcome } from './settingsState'

interface WelcomeScreenProps {
  activeProject: { name: string; path?: string } | undefined
  onPick: (text: string) => void
  onOpenSettings: () => void
}

const CHECKLIST_DISMISS_KEY = 'pawn-welcome-checklist-dismissed'

type ChecklistItem = {
  id: string
  label: string
  done: boolean
  action?: () => void
  actionLabel?: string
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
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon === 'code' && (
        <>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </>
      )}
      {icon === 'globe' && (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </>
      )}
      {icon === 'monitor' && (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </>
      )}
      {icon === 'calendar' && (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </>
      )}
    </svg>
  )
}

export default function WelcomeScreen({
  activeProject,
  onPick,
  onOpenSettings
}: WelcomeScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const providers = useProviderStore((s) => s.providers)
  const projects = useAppStore((s) => s.projects)
  const needsSetup = providers.filter((p) => p.enabled).length === 0
  // "Add a key" is only done when a working provider exists: enabled, with a
  // credential (or a sign-in format that needs none), and not failed by the
  // auto-test that runs right after a preset is added.
  const providerReady = providers.some(
    (p) =>
      p.enabled &&
      __providerTestOutcome[p.id] !== 'fail' &&
      (p.apiKey || p.apiFormat === 'kiro')
  )
  const hasProject =
    Boolean(activeProject && activeProject.name && !String(activeProject.name).startsWith('__')) ||
    projects.some((p) => p.id !== '__general__' && Array.isArray(p.paths) && p.paths.length > 0)

  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [hour, setHour] = useState(() => new Date().getHours())
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(CHECKLIST_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const timer = setInterval(() => { setHour(new Date().getHours()) }, 60000)
    return () => { clearInterval(timer) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const status = window.api?.connections?.status
    if (typeof status !== 'function') {
      setGithubConnected(null)
      return
    }
    void status('github')
      .then((res) => {
        if (cancelled) return
        const r = res as { connected?: boolean; ok?: boolean; status?: string } | undefined
        setGithubConnected(Boolean(r?.connected || r?.ok || r?.status === 'connected'))
      })
      .catch(() => {
        if (!cancelled) setGithubConnected(false)
      })
    return () => {
      cancelled = true
    }
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

  const checklist: ChecklistItem[] = useMemo(() => {
    const items: ChecklistItem[] = [
      {
        id: 'provider',
        label: t('chat.checklist.provider'),
        done: providerReady,
        action: providerReady ? undefined : () => openSettingsSection('providers'),
        actionLabel: t('chat.configureProviders')
      },
      {
        id: 'project',
        label: t('chat.checklist.project'),
        done: hasProject,
        action: !hasProject
          ? () => {
              window.dispatchEvent(new CustomEvent('pawn:add-project'))
            }
          : undefined,
        actionLabel: t('chat.checklist.openProject')
      },
      {
        id: 'github',
        label: t('chat.checklist.github'),
        done: githubConnected === true,
        action:
          githubConnected !== true
            ? () => {
                openSettingsSection('connections')
              }
            : undefined,
        actionLabel: t('chat.checklist.connectGithub')
      }
    ]
    return items
  }, [t, needsSetup, providerReady, hasProject, githubConnected])

  // Only the provider is required. Project and GitHub are optional, so once
  // a provider works the list only stays while it's still useful: on a
  // project chat before GitHub is connected. Everyday work (no project)
  // never nags about folders or GitHub after setup.
  const inProject = Boolean(activeProject && activeProject.name && !String(activeProject.name).startsWith('__'))
  const visibleChecklist = needsSetup ? checklist : inProject ? checklist.filter((c) => c.id !== 'project') : []
  const allDone = visibleChecklist.every((c) => c.done)
  const showChecklist = !dismissed && visibleChecklist.length > 0 && !allDone

  const dismissChecklist = (): void => {
    setDismissed(true)
    try {
      localStorage.setItem(CHECKLIST_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="chat-welcome">
      <div className="welcome-logo" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor">
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

      {showChecklist && (
        <div className="welcome-checklist" role="region" aria-label={t('chat.checklist.title')}>
          <div className="welcome-checklist-head">
            <span className="welcome-checklist-title">{t('chat.checklist.title')}</span>
            <button type="button" className="welcome-checklist-dismiss" onClick={dismissChecklist}>
              {t('chat.checklist.dismiss')}
            </button>
          </div>
          <p className="welcome-checklist-desc">{t('chat.checklist.desc')}</p>
          <ul className="welcome-checklist-list">
            {visibleChecklist.map((item) => (
              <li
                key={item.id}
                className={`welcome-checklist-item ${item.done ? 'done' : 'pending'}`}
              >
                <span className="welcome-checklist-mark" aria-hidden="true">
                  {item.done ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span className="welcome-checklist-dot" />
                  )}
                </span>
                <span className="welcome-checklist-label">{item.label}</span>
                {!item.done && item.action && item.actionLabel && (
                  <button type="button" className="welcome-checklist-action" onClick={item.action}>
                    {item.actionLabel}
                  </button>
                )}
              </li>
            ))}
          </ul>
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
        {needsSetup && (
          <button type="button" className="welcome-btn primary" onClick={onOpenSettings}>
            <span className="welcome-btn-icon" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span className="welcome-btn-text">
              <span className="welcome-btn-title">{t('chat.configureProviders')}</span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
