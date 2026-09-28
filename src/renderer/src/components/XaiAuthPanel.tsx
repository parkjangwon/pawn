import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * xAI sign-in on a provider row. Device-code OAuth (SuperGrok / X Premium+).
 * A pasted API key still works and is used when nobody is signed in.
 */
export default function XaiAuthPanel({ onSignedIn }: { onSignedIn?: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const api = window.api?.xai
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ userCode: string; url: string } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return
    const s = await api.status().catch(() => null)
    setSignedIn(Boolean(s?.signedIn))
    setEmail(s?.email || '')
  }, [api])

  useEffect(() => {
    void refresh()
    if (!api?.onLoginDone) return
    return api.onLoginDone((r) => {
      setDevice(null)
      setBusy(false)
      if (r.ok) {
        setError('')
        void refresh()
        onSignedIn?.()
      } else setError(r.error || t('settings.providerSection.xai.failed'))
    })
  }, [api, refresh, onSignedIn, t])

  if (!api) return <div className="settings-row-desc">{t('settings.providerSection.xai.desktopOnly')}</div>

  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await api.startLogin().catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    if (!r.ok) {
      setBusy(false)
      setError(r.error)
      return
    }
    setDevice({ userCode: r.userCode, url: r.verificationUriComplete || r.verificationUri })
  }

  return (
    <div className="kiro-auth">
      <div className="settings-row-desc">
        {signedIn
          ? t('settings.providerSection.xai.signedIn', { email: email || t('settings.providerSection.xai.account') })
          : t('settings.providerSection.xai.signedOut')}
      </div>
      {device && (
        <div className="settings-row-desc">
          {t('settings.providerSection.xai.enterCode')} <strong className="kiro-code">{device.userCode}</strong>{' '}
          <a href={device.url} target="_blank" rel="noreferrer">
            {t('settings.providerSection.xai.openPage')}
          </a>{' '}
          <button
            type="button"
            className="test-btn"
            onClick={() => void api.cancelLogin().then(() => {
              setDevice(null)
              setBusy(false)
            })}
          >
            {t('common.cancel')}
          </button>
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
              {t('settings.providerSection.xai.signOut')}
            </button>
          ) : (
            <button type="button" className="test-btn" disabled={busy} onClick={() => void start()}>
              {t('settings.providerSection.xai.signIn')}
            </button>
          )}
        </div>
      )}
      {error && <div className="settings-row-desc kiro-error">{error}</div>}
      <div className="settings-row-desc kiro-note">{t('settings.providerSection.xai.note')}</div>
    </div>
  )
}
