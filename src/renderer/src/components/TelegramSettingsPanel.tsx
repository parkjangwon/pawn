import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import './TelegramSettingsPanel.css'

const BOT_FATHER = 'https://t.me/BotFather'

type StepId = 'token' | 'project' | 'enable' | 'pair'

function isStatus(v: TelegramStatusDto | { ok: false; error: string } | void): v is TelegramStatusDto {
  return !!v && v.ok === true && 'hasToken' in v
}

function botHref(username: string | undefined): string | null {
  if (!username || !/^[A-Za-z0-9_]{4,32}$/.test(username)) return null
  return `https://t.me/${username}`
}

function personLabel(row: { username?: string; firstName?: string; userId: string }): string {
  if (row.username) return `@${row.username}`
  return row.firstName || row.userId
}

export default function TelegramSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const [status, setStatus] = useState<TelegramStatusDto | null>(null)
  const [token, setToken] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [userId, setUserId] = useState('')
  const [userError, setUserError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const copyTimer = useRef<number | null>(null)
  const preview = window.api?.platform === 'browser'

  const reload = useCallback(async () => {
    const next = await window.api?.telegram?.status()?.catch?.(() => undefined)
    if (isStatus(next)) setStatus(next)
  }, [])

  useEffect(() => {
    void reload()
    return window.api?.telegram?.onEvent?.(() => {
      void reload()
    })
  }, [reload])

  useEffect(() => () => {
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
  }, [])

  const folders = projects.filter((p) => p.id !== '__general__' && p.paths.length > 0)
  const hasToken = !!status?.hasToken
  const hasProject = !!status?.projectId && folders.some((p) => p.id === status.projectId)
  const botOn = hasToken && !!status?.enabled
  const paired = (status?.allowFrom || []).length > 0
  const pending = status?.pending || []
  const showTokenForm = !hasToken || replacing
  const href = botHref(status?.username)

  const steps: { id: StepId; done: boolean; label: string }[] = [
    { id: 'token', done: hasToken, label: t('settings.telegramSection.stepToken') },
    { id: 'project', done: hasProject, label: t('settings.telegramSection.stepProject') },
    { id: 'enable', done: botOn, label: t('settings.telegramSection.stepEnable') },
    { id: 'pair', done: paired, label: t('settings.telegramSection.stepPair') }
  ]
  const now = steps.find((step) => !step.done)?.id

  const apply = async (result: TelegramStatusDto | { ok: false; error: string } | void): Promise<void> => {
    if (isStatus(result)) {
      setStatus(result)
      setFormError(null)
      return
    }
    if (result && result.ok === false) {
      setFormError(result.error === 'invalid_token' ? t('settings.telegramSection.tokenInvalid') : result.error)
    }
  }

  const saveToken = async (): Promise<void> => {
    const value = token.trim()
    if (!value) return
    setBusy(true)
    try {
      const result = await window.api?.telegram?.setToken(value)
      await apply(result)
      if (isStatus(result) && result.hasToken) {
        setToken('')
        setReplacing(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const addUser = async (): Promise<void> => {
    const value = userId.trim()
    if (!value) return
    setBusy(true)
    try {
      const result = await window.api?.telegram?.allowUser(value)
      if (result && result.ok === false) {
        setUserError(result.error === 'bad_user' ? t('settings.telegramSection.addUserInvalid') : result.error)
        return
      }
      if (isStatus(result)) {
        setStatus(result)
        setUserId('')
        setUserError(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      return
    }
    setCopied(code)
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => {
      setCopied((current) => (current === code ? null : current))
    }, 1600)
  }

  const errorText = (code: string | undefined): string => {
    if (!code) return ''
    if (code === 'token_rejected') return t('settings.telegramSection.tokenRejected')
    if (code === 'conflict') return t('settings.telegramSection.conflict')
    return code
  }

  const jump = (id: StepId): void => {
    document.getElementById(`telegram-step-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  if (!window.api?.telegram) {
    return (
      <div className="settings-section">
        <h2>{t('settings.telegramSection.title')}</h2>
        <p className="settings-desc">{t('settings.telegramSection.desktopOnly')}</p>
      </div>
    )
  }

  const commands: { cmd: string; label: string }[] = [
    { cmd: '/new', label: t('settings.telegramSection.cmdNew') },
    { cmd: '/stop', label: t('settings.telegramSection.cmdStop') },
    { cmd: '/plan', label: t('settings.telegramSection.cmdPlan') },
    { cmd: '/build', label: t('settings.telegramSection.cmdBuild') },
    { cmd: '/sessions', label: t('settings.telegramSection.cmdSessions') },
    { cmd: '/chat', label: t('settings.telegramSection.cmdChat') },
    { cmd: '/tasks', label: t('settings.telegramSection.cmdTasks') },
    { cmd: '/changes', label: t('settings.telegramSection.cmdChanges') },
    { cmd: '/undo', label: t('settings.telegramSection.cmdUndo') },
    { cmd: '/model', label: t('settings.telegramSection.cmdModel') },
    { cmd: '/compact', label: t('settings.telegramSection.cmdCompact') },
    { cmd: '/project', label: t('settings.telegramSection.cmdProject') },
    { cmd: '/usage', label: t('settings.telegramSection.cmdUsage') },
    { cmd: '/help', label: t('settings.telegramSection.cmdHelp') },
    { cmd: '/status', label: t('settings.telegramSection.cmdStatus') },
    { cmd: '/whoami', label: t('settings.telegramSection.cmdWhoami') }
  ]

  return (
    <div className="settings-section telegram-panel">
      <h2>{t('settings.telegramSection.title')}</h2>
      <p className="settings-desc">{t('settings.telegramSection.desc')}</p>
      {preview && <p className="settings-desc">{t('settings.telegramSection.desktopOnly')}</p>}

      <ol className="telegram-steps" aria-label={t('settings.telegramSection.steps')}>
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              className={`telegram-step${step.done ? ' done' : ''}${now === step.id ? ' now' : ''}`}
              aria-current={now === step.id ? 'step' : undefined}
              onClick={() => jump(step.id)}
            >
              {step.done ? (
                <svg className="telegram-step-mark" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="telegram-step-kicker">{index + 1}</span>
              )}
              <span className="telegram-step-label">{step.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="settings-card" id="telegram-step-token">
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label" id="telegram-token-label">{t('settings.telegramSection.token')}</span>
            <span className="settings-row-desc">
              {hasToken
                ? status?.username
                  ? t('settings.telegramSection.connected', { username: status.username })
                  : t('settings.telegramSection.tokenSaved')
                : t('settings.telegramSection.tokenDesc')}
            </span>
          </div>
          {hasToken && !replacing && (
            <div className="telegram-actions">
              {href && (
                <a className="btn-cancel telegram-link" href={href} target="_blank" rel="noreferrer">
                  {t('settings.telegramSection.openBot', { username: status?.username })}
                </a>
              )}
              <button type="button" className="btn-cancel" onClick={() => setReplacing(true)}>
                {t('settings.telegramSection.replaceToken')}
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setReplacing(true)
                  setToken('')
                  void window.api?.telegram?.clearToken().then((r) => apply(r))
                }}
              >
                {t('settings.telegramSection.clearToken')}
              </button>
            </div>
          )}
          {showTokenForm && (
            <form
              className="telegram-form"
              onSubmit={(e) => {
                e.preventDefault()
                void saveToken()
              }}
            >
              <input
                id="telegram-token"
                type="password"
                value={token}
                autoComplete="off"
                spellCheck={false}
                aria-labelledby="telegram-token-label"
                placeholder={t('settings.telegramSection.tokenPlaceholder')}
                onChange={(e) => setToken(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={busy || !token.trim()}>
                {t('settings.telegramSection.saveToken')}
              </button>
              <a className="btn-cancel telegram-link" href={BOT_FATHER} target="_blank" rel="noreferrer">
                {t('settings.telegramSection.openBotFather')}
              </a>
              {replacing && (
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setReplacing(false)
                    setToken('')
                    setFormError(null)
                  }}
                >
                  {t('common.cancel')}
                </button>
              )}
            </form>
          )}
          {formError && <p className="telegram-error">{formError}</p>}
        </div>

        <div className="settings-row" id="telegram-step-project">
          <div className="settings-row-info">
            <label className="settings-row-label" htmlFor="telegram-project">{t('settings.telegramSection.project')}</label>
            <span className="settings-row-desc">
              {folders.length === 0 ? t('settings.telegramSection.noProjects') : t('settings.telegramSection.projectDesc')}
            </span>
          </div>
          <select
            id="telegram-project"
            value={hasProject ? status?.projectId : ''}
            disabled={folders.length === 0}
            onChange={(e) => {
              void window.api?.telegram?.setProject(e.target.value).then((r) => apply(r))
            }}
          >
            <option value="">{t('settings.telegramSection.projectNone')}</option>
            {folders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row" id="telegram-step-enable">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.telegramSection.enable')}</span>
            <span className="settings-row-desc">
              {hasToken ? t('settings.telegramSection.enableDesc') : t('settings.telegramSection.enableNeedsToken')}
            </span>
            <span className={`telegram-status${status?.polling ? ' on' : status?.error ? ' bad' : ''}`}>
              {status?.polling ? t('settings.telegramSection.polling') : t('settings.telegramSection.stopped')}
            </span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t('settings.telegramSection.enable')}
              checked={!!status?.enabled}
              disabled={!hasToken}
              onChange={(e) => {
                void window.api?.telegram?.setEnabled(e.target.checked).then((r) => apply(r))
              }}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        {status?.error && <p className="telegram-error">{errorText(status.error)}</p>}
      </div>

      <div className={`settings-card${pending.length > 0 ? ' telegram-card-alert' : ''}`} id="telegram-step-pair">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.telegramSection.pending')}</span>
            {pending.length === 0 && <span className="settings-row-desc">{t('settings.telegramSection.pendingEmpty')}</span>}
          </div>
        </div>
        {pending.map((p) => (
          <div className="settings-row" key={p.code}>
            <div className="settings-row-info">
              <span className="settings-row-label">{personLabel(p)}</span>
              <span className="telegram-code">{p.code}</span>
              <span className="settings-row-desc">{p.userId}</span>
            </div>
            <div className="telegram-actions">
              <button type="button" className="btn-cancel" onClick={() => void copyCode(p.code)}>
                {copied === p.code ? t('settings.telegramSection.copied') : t('settings.telegramSection.copyCode')}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  void window.api?.telegram?.approve(p.code).then((r) => apply(r))
                }}
              >
                {t('settings.telegramSection.approve')}
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  void window.api?.telegram?.deny(p.code).then((r) => apply(r))
                }}
              >
                {t('settings.telegramSection.deny')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.telegramSection.paired')}</span>
            {(status?.allowFrom || []).length === 0 && (
              <span className="settings-row-desc">{t('settings.telegramSection.pairedEmpty')}</span>
            )}
          </div>
        </div>
        {(status?.allowFrom || []).map((u) => (
          <div className="settings-row" key={u.userId}>
            <div className="settings-row-info">
              <span className="settings-row-label">{personLabel(u)}</span>
              <span className="settings-row-desc">{u.userId}</span>
            </div>
            <button
              type="button"
              className="btn-cancel"
              onClick={() => {
                void window.api?.telegram?.revoke(u.userId).then((r) => apply(r))
              }}
            >
              {t('settings.telegramSection.revoke')}
            </button>
          </div>
        ))}
        <div className="settings-row settings-row-stack">
          <span className="settings-row-desc">{t('settings.telegramSection.addUserDesc')}</span>
          <form
            className="telegram-form"
            onSubmit={(e) => {
              e.preventDefault()
              void addUser()
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={userId}
              aria-label={t('settings.telegramSection.addUserPlaceholder')}
              placeholder={t('settings.telegramSection.addUserPlaceholder')}
              onChange={(e) => {
                setUserId(e.target.value)
                setUserError(null)
              }}
            />
            <button type="submit" className="btn-primary" disabled={busy || !userId.trim()}>
              {t('settings.telegramSection.addUser')}
            </button>
          </form>
          {userError && <p className="telegram-error">{userError}</p>}
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.telegramSection.commands')}</span>
            <span className="settings-row-desc">{t('settings.telegramSection.groupsNote')}</span>
          </div>
          <ul className="telegram-commands">
            {commands.map((row) => (
              <li key={row.cmd}>
                <code>{row.cmd}</code>
                <span>{row.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
