import { useCallback, useEffect, useRef, useState } from 'react'
import { tx } from '../i18n'
import { useAppStore } from '../stores/app'
import Button from './Button'
import Input from './Input'
import Select from './Select'
import Switch from './Switch'
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
    { id: 'token', done: hasToken, label: 'Save the bot token' },
    { id: 'project', done: hasProject, label: 'Choose a project' },
    { id: 'enable', done: botOn, label: 'Turn the bot on' },
    { id: 'pair', done: paired, label: 'Approve an account' }
  ]
  const now = steps.find((step) => !step.done)?.id

  const apply = async (result: TelegramStatusDto | { ok: false; error: string } | void): Promise<void> => {
    if (isStatus(result)) {
      setStatus(result)
      setFormError(null)
      return
    }
    if (result && result.ok === false) {
      setFormError(result.error === 'invalid_token' ? 'That does not look like a BotFather token.' : errorText(result.error))
    }
  }

  /** Fire an IPC call and route both its result and any transport error into the UI. */
  const run = (p: Promise<TelegramStatusDto | { ok: false; error: string }> | undefined): void => {
    p?.then((r) => void apply(r)).catch((err) => { console.warn('[telegram]', err); setFormError('Something failed — see the console for details.') })
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
    } catch (err) {
      console.warn('[telegram]', err)
      setFormError('Something failed — see the console for details.')
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
        setUserError(result.error === 'bad_user' ? 'A Telegram user id is numeric only, e.g. 123456789.' : 'Something failed — see the console for details.')
        return
      }
      if (isStatus(result)) {
        setStatus(result)
        setUserId('')
        setUserError(null)
      }
    } catch (err) {
      setUserError(err instanceof Error ? err.message : String(err))
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
    if (code === 'token_rejected') return 'Telegram rejected the token. Create a new one in BotFather.'
    if (code === 'conflict') return 'Another app is already polling this bot. Stop that poller and toggle the bot again.'
    return 'Something failed — see the console for details.' + ' (' + code.slice(0, 60) + ')'
  }

  const jump = (id: StepId): void => {
    document.getElementById(`telegram-step-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  if (!window.api?.telegram) {
    return (
      <div className="settings-section">
        <h2>{'Telegram'}</h2>
        <p className="settings-desc">{'The browser preview cannot keep a bot connection open. Use the desktop app to connect.'}</p>
      </div>
    )
  }

  const commands: { cmd: string; label: string }[] = [
    { cmd: '/new', label: 'Start a fresh chat.' },
    { cmd: '/stop', label: 'Cancel the turn in progress.' },
    { cmd: '/plan', label: 'Plan mode: research and propose without changes (/plan <request>).' },
    { cmd: '/build', label: 'Back to build mode: full tools.' },
    { cmd: '/sessions', label: 'List recent chats.' },
    { cmd: '/chat', label: 'Switch to a recent chat (/chat <number>).' },
    { cmd: '/tasks', label: 'Show the task list of this chat.' },
    { cmd: '/changes', label: 'Show files the agent changed.' },
    { cmd: '/undo', label: 'Revert a change set (/undo <number>).' },
    { cmd: '/model', label: 'Show the model and context fill.' },
    { cmd: '/compact', label: 'Shrink the chat context.' },
    { cmd: '/project', label: 'Show the folder the agent runs in.' },
    { cmd: '/usage', label: 'Show spend over the last 24 hours.' },
    { cmd: '/help', label: 'Show what the bot can do.' },
    { cmd: '/status', label: 'Show whether the bot is listening.' },
    { cmd: '/whoami', label: 'Show your Telegram user id.' }
  ]

  return (
    <div className="settings-section telegram-panel">
      <h2>{'Telegram'}</h2>
      <p className="settings-desc">{'Control this Pawn from a private Telegram bot. Strangers get a pairing code and nothing else until you approve them here.'}</p>

      <ol className="telegram-steps" aria-label={'Setup'}>
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
            <span className="settings-row-label" id="telegram-token-label">{'Bot token'}</span>
            <span className="settings-row-desc">
              {hasToken
                ? status?.username
                  ? `Connected as @${status.username}`
                  : 'Token saved'
                : 'From BotFather. Sealed in the OS keychain on this computer, and never shown again.'}
            </span>
          </div>
          {hasToken && !replacing && (
            <div className="telegram-actions">
              {href && (
                <a className="btn-cancel telegram-link" href={href} target="_blank" rel="noreferrer">
                  {`Open @${status?.username}`}
                </a>
              )}
              <Button type="button" variant="secondary" onClick={() => setReplacing(true)}>
                {'Replace token'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setReplacing(true)
                  setToken('')
                  run(window.api?.telegram?.clearToken())
                }}
              >
                {'Remove token'}
              </Button>
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
              <Input
                id="telegram-token"
                type="password"
                value={token}
                autoComplete="off"
                spellCheck={false}
                aria-labelledby="telegram-token-label"
                placeholder={'123456:ABC…'}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button type="submit" disabled={busy || !token.trim()}>
                {'Save token'}
              </Button>
              <a className="btn-cancel telegram-link" href={BOT_FATHER} target="_blank" rel="noreferrer">
                {'Open BotFather'}
              </a>
              {replacing && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setReplacing(false)
                    setToken('')
                    setFormError(null)
                  }}
                >
                  {'Cancel'}
                </Button>
              )}
            </form>
          )}
          {formError && <p className="telegram-error">{formError}</p>}
        </div>

        <div className="settings-row" id="telegram-step-project">
          <div className="settings-row-info">
            <label className="settings-row-label" htmlFor="telegram-project">{'Project'}</label>
            <span className="settings-row-desc">
              {folders.length === 0 ? 'Add a project folder in the sidebar first. Remote messages need a folder.' : 'Remote messages run the agent in this folder.'}
            </span>
          </div>
          <Select
            id="telegram-project"
            value={hasProject ? status?.projectId : ''}
            disabled={folders.length === 0}
            onChange={(e) => {
              run(window.api?.telegram?.setProject(e.target.value))
            }}
          >
            <option value="">{'Choose a project'}</option>
            {folders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="settings-row" id="telegram-step-enable">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Enable bot'}</span>
            <span className="settings-row-desc">
              {hasToken ? 'Listen while Pawn is open. Quitting the app stops the bot.' : 'Save a token before turning the bot on.'}
            </span>
            <span className={`telegram-status${status?.polling ? ' on' : status?.error ? ' bad' : ''}`}>
              {status?.polling ? 'Listening for messages' : 'Not listening'}
            </span>
          </div>
          <Switch
            checked={!!status?.enabled}
            disabled={!hasToken}
            aria-label={'Enable bot'}
            onCheckedChange={(v) => {
              run(window.api?.telegram?.setEnabled(v))
            }}
          />
        </div>
        {status?.error && <p className="telegram-error">{errorText(status.error)}</p>}
      </div>

      <div className={`settings-card${pending.length > 0 ? ' telegram-card-alert' : ''}`} id="telegram-step-pair">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Waiting for approval'}</span>
            {pending.length === 0 && <span className="settings-row-desc">{'No pairing requests.'}</span>}
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
              <Button type="button" variant="secondary" onClick={() => void copyCode(p.code)}>
                {copied === p.code ? 'Copied' : 'Copy'}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  run(window.api?.telegram?.approve(p.code))
                }}
              >
                {'Approve'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  run(window.api?.telegram?.deny(p.code))
                }}
              >
                {'Deny'}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Paired accounts'}</span>
            {(status?.allowFrom || []).length === 0 && (
              <span className="settings-row-desc">{'Nobody is paired yet. Message the bot, then approve the code here.'}</span>
            )}
          </div>
        </div>
        {(status?.allowFrom || []).map((u) => (
          <div className="settings-row" key={u.userId}>
            <div className="settings-row-info">
              <span className="settings-row-label">{personLabel(u)}</span>
              <span className="settings-row-desc">{u.userId}</span>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                run(window.api?.telegram?.revoke(u.userId))
              }}
            >
              {'Revoke'}
            </Button>
          </div>
        ))}
        <div className="settings-row settings-row-stack">
          <span className="settings-row-desc">{'Already know your numeric user id? Add it here to pair without a code. Then message the bot to start.'}</span>
          <form
            className="telegram-form"
            onSubmit={(e) => {
              e.preventDefault()
              void addUser()
            }}
          >
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={userId}
              aria-label={'Telegram user id'}
              placeholder={'Telegram user id'}
              onChange={(e) => {
                setUserId(e.target.value)
                setUserError(null)
              }}
            />
            <Button type="submit" disabled={busy || !userId.trim()}>
              {'Add user'}
            </Button>
          </form>
          {userError && <p className="telegram-error">{userError}</p>}
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Commands'}</span>
            <span className="settings-row-desc">{'Group chats are ignored. The bot uses the same permission mode as this app.'}</span>
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
