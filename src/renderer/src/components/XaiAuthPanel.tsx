import { useCallback, useEffect, useState } from 'react'
import { tx } from '../i18n'

/**
 * xAI sign-in on a provider row. Device-code OAuth (SuperGrok / X Premium+).
 * A pasted API key still works and is used when nobody is signed in.
 */
export default function XaiAuthPanel({ onSignedIn }: { onSignedIn?: () => void }): React.JSX.Element {
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
      } else setError(r.error || 'xAI sign-in failed')
    })
  }, [api, refresh, onSignedIn])

  if (!api) return <div className="settings-row-desc">{'xAI sign-in is available in the desktop app. Paste an API key to use it here.'}</div>

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
          ? `Signed in to xAI (${email || 'account'}). This session is used instead of an API key.`
          : 'Not signed in. Paste an API key, or sign in with a SuperGrok / X Premium+ account.'}
      </div>
      {device && (
        <div className="settings-row-desc">
          {'Confirm this code in your browser:'} <strong className="kiro-code">{device.userCode}</strong>{' '}
          <a href={device.url} target="_blank" rel="noreferrer">
            {'Open sign-in page'}
          </a>{' '}
          <button
            type="button"
            className="test-btn"
            onClick={() => void api.cancelLogin().then(() => {
              setDevice(null)
              setBusy(false)
            }).catch(() => {})}
          >
            {'Cancel'}
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
              {'Sign out'}
            </button>
          ) : (
            <button type="button" className="test-btn" disabled={busy} onClick={() => void start()}>
              {'Sign in with xAI'}
            </button>
          )}
        </div>
      )}
      {error && <div className="settings-row-desc kiro-error">{error}</div>}
      <div className="settings-row-desc kiro-note">{'Subscription sign-in uses the public Grok sign-in. If xAI rejects the session, sign out and use an API key from console.x.ai.'}</div>
    </div>
  )
}
