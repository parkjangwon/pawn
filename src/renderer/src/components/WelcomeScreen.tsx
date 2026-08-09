import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useAppStore } from '../stores/app'

export interface WelcomeSuggestion {
  icon: string
  text: string
}

interface WelcomeScreenProps {
  activeProject: { name: string; path?: string } | undefined
  suggestions: WelcomeSuggestion[]
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

export default function WelcomeScreen({
  activeProject,
  suggestions,
  onPick,
  onOpenSettings
}: WelcomeScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const providers = useProviderStore((s) => s.providers)
  const projects = useAppStore((s) => s.projects)
  const needsSetup = providers.filter((p) => p.enabled).length === 0
  const hasProject =
    Boolean(activeProject && activeProject.name && !String(activeProject.name).startsWith('__')) ||
    projects.some((p) => p.id !== '__general__' && Array.isArray(p.paths) && p.paths.length > 0)

  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(CHECKLIST_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

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

  const checklist: ChecklistItem[] = useMemo(() => {
    const items: ChecklistItem[] = [
      {
        id: 'provider',
        label: t('chat.checklist.provider'),
        done: !needsSetup,
        action: needsSetup ? onOpenSettings : undefined,
        actionLabel: t('chat.configureProviders')
      },
      {
        id: 'project',
        label: t('chat.checklist.project'),
        done: hasProject,
        action: !hasProject
          ? () => {
              // Project picker lives in the sidebar; surface a guided prompt.
              onPick(t('chat.checklist.projectHint'))
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
                onOpenSettings()
              }
            : undefined,
        actionLabel: t('chat.checklist.connectGithub')
      }
    ]
    return items
  }, [t, needsSetup, hasProject, githubConnected, onOpenSettings, onPick])

  const allDone = checklist.every((c) => c.done)
  const showChecklist = !dismissed && !allDone

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
      <div className="welcome-icon">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.4"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <h1>
        {activeProject
          ? t('chat.welcomeProject', { name: activeProject.name })
          : t('chat.welcome')}
      </h1>
      {!activeProject && <p>{t('chat.welcomeSub')}</p>}

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
            {checklist.map((item) => (
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
        {suggestions.map((s, i) => (
          <button key={i} className="welcome-btn" onClick={() => { onPick(s.text) }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {s.icon === 'code' && (
                <>
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </>
              )}
              {s.icon === 'globe' && (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </>
              )}
              {s.icon === 'file' && (
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </>
              )}
              {s.icon === 'calendar' && (
                <>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </>
              )}
              {s.icon === 'monitor' && (
                <>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </>
              )}
              {s.icon === 'edit' && (
                <>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </>
              )}
            </svg>
            <span>{s.text}</span>
          </button>
        ))}
        {needsSetup && (
          <button className="welcome-btn primary" onClick={onOpenSettings}>
            <svg
              width="16"
              height="16"
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
            <span>{t('chat.configureProviders')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
