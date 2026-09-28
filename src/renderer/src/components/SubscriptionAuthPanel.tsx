import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Kind = 'chatgpt' | 'claude' | 'antigravity'

type LoginResult =
  | {
      ok: true
      userCode?: string
      verificationUri?: string
      verificationUriComplete?: string
      expiresIn?: number
    }
  | { ok: false; error: string }

interface SubApi {
  status: () => Promise<{ signedIn: boolean; email?: string }>
  startLogin: () => Promise<LoginResult>
  submitCode?: (code: string) => Promise<{ ok: boolean; error?: string; email?: string }>
  cancelLogin: () => Promise<{ ok: boolean }>
  signOut: () => Promise<{ ok: boolean }>
  onLoginDone?: (cb: (result: { ok: boolean; email?: string; error?: string }) => void) => () => void
}

const COPY: Record<Kind, { ns: string; mode: 'device' | 'paste' | 'browser' }> = {
  chatgpt: { ns: 'settings.providerSection.chatgpt', mode: 'device' },
  claude: { ns: 'settings.providerSection.claudeSub', mode: 'paste' },
  antigravity: { ns: 'settings.providerSection.antigravity', mode: 'browser' }
}

function apiFor(kind: Kind): SubApi | undefined {
  if (kind === 'chatgpt') return window.api?.chatgpt
  if (kind === 'claude') return window.api?.claudeOauth
  return window.api?.antigravity
}

/**
 * Subscription sign-in on a provider row.
 * ChatGPT uses a device code. Claude asks for the code the consent page shows.
 * Antigravity finishes in the browser and calls back to localhost.
 */
export default function SubscriptionAuthPanel({
  kind,
  onSignedIn
}: {
  kind: Kind
  onSignedIn?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const copy = COPY[kind]
  const api = apiFor(kind)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ userCode?: string; url: string } | null>(null)
  const [paste, setPaste] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return
    const status = await api.status().catch(() => null)
    setSignedIn(Boolean(status?.signedIn))
    setEmail(status?.email || '')
  }, [api])

  useEffect(() => {
    void refresh()
    if (!api?.onLoginDone) return
    return api.onLoginDone((result) => {
      setDevice(null)
      setPaste('')
      setBusy(false)
      if (result.ok) {
        setError('')
        void refresh()
        onSignedIn?.()
      } else setError(result.error || t(`${copy.ns}.failed`))
    })
  }, [api, refresh, onSignedIn, t, copy.ns])

  if (!api) return <div className="settings-row-desc">{t(`${copy.ns}.desktopOnly`)}</div>

  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await api.startLogin().catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    if (!result.ok) {
      setBusy(false)
      setError(result.error)
      return
    }
    if (copy.mode === 'device' || result.userCode) {
      setDevice({ userCode: result.userCode, url: result.verificationUriComplete || result.verificationUri || '' })
      return
    }
    setDevice({ url: result.verificationUriComplete || result.verificationUri || '' })
    if (copy.mode === 'paste') setBusy(false)
  }

  const submit = async (): Promise<void> => {
    if (!api.submitCode) return
    setBusy(true)
    setError('')
    const result = await api.submitCode(paste).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    setBusy(false)
    if (!result.ok) {
      setError(result.error || t(`${copy.ns}.failed`))
      return
    }
    setDevice(null)
    setPaste('')
    await refresh()
    onSignedIn?.()
  }

  return (
    <div className="kiro-auth">
      <div className="settings-row-desc">
        {signedIn
          ? t(`${copy.ns}.signedIn`, { email: email || t(`${copy.ns}.account`) })
          : t(`${copy.ns}.signedOut`)}
      </div>
      {device && (
        <div className="settings-row-desc">
          {device.userCode && (
            <>
              {t(`${copy.ns}.enterCode`)} <strong className="kiro-code">{device.userCode}</strong>{' '}
            </>
          )}
          {copy.mode === 'browser' && <span>{t(`${copy.ns}.waiting`)} </span>}
          {device.url && (
            <a href={device.url} target="_blank" rel="noreferrer">
              {t('settings.providerSection.xai.openPage')}
            </a>
          )}{' '}
          <button
            type="button"
            className="test-btn"
            onClick={() => void api.cancelLogin().then(() => {
              setDevice(null)
              setPaste('')
              setBusy(false)
            })}
          >
            {t('common.cancel')}
          </button>
          {copy.mode === 'paste' && (
            <div className="form-actions kiro-actions">
              <input
                type="text"
                value={paste}
                placeholder={t(`${copy.ns}.pastePlaceholder`)}
                onChange={(e) => setPaste(e.target.value)}
              />
              <button type="button" className="test-btn" disabled={busy || !paste.trim()} onClick={() => void submit()}>
                {t(`${copy.ns}.submitCode`)}
              </button>
            </div>
          )}
          {copy.mode === 'paste' && <div className="settings-row-desc">{t(`${copy.ns}.pastePrompt`)}</div>}
        </div>
      )}
      {!device && (
        <div className="form-actions kiro-actions">
          {signedIn ? (
            <button
              type="button"
              className="test-btn"
              disabled={busy}
              onClick={() => void api.signOut().then(() => refresh())}
            >
              {t(`${copy.ns}.signOut`)}
            </button>
          ) : (
            <button type="button" className="test-btn" disabled={busy} onClick={() => void start()}>
              {t(`${copy.ns}.signIn`)}
            </button>
          )}
        </div>
      )}
      {error && <div className="settings-row-desc kiro-error">{error}</div>}
      <div className="settings-row-desc kiro-note">{t(`${copy.ns}.note`)}</div>
    </div>
  )
}
