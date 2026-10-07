import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './Button'
import Input from './Input'

type Form = null | 'idc' | 'apiKey'

/**
 * Kiro sign-in for a Kiro provider row: AWS Builder ID / IAM Identity Center
 * (device flow), Kiro API key, or the existing Kiro CLI / IDE login.
 * Credentials never reach the renderer — the main process holds them.
 */
export default function KiroAuthPanel({ onSignedIn }: { onSignedIn?: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const api = window.api?.kiro
  const [status, setStatus] = useState<KiroStatusDto | null>(null)
  const [usage, setUsage] = useState<{ used?: number; limit?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ userCode: string; url: string } | null>(null)
  const [form, setForm] = useState<Form>(null)
  const [startUrl, setStartUrl] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [apiKey, setApiKey] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return
    const s = await api.status().catch(() => null)
    setStatus(s)
    if (s?.signedIn) {
      const u = await api.usage().catch(() => null)
      setUsage(u?.ok && u.usage ? u.usage : null)
    } else setUsage(null)
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
      } else setError(r.error || t('settings.providerSection.kiro.failed'))
    })
  }, [api, refresh, onSignedIn, t])

  if (!api) return <div className="settings-row-desc">{t('settings.providerSection.kiro.desktopOnly')}</div>

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await fn()
      if (!r.ok) setError(r.error || t('settings.providerSection.kiro.failed'))
      else {
        setForm(null)
        after?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const startDevice = async (mode: 'builder-id' | 'idc'): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await api.startLogin(mode === 'idc' ? { mode, startUrl: startUrl.trim(), region: region.trim() } : { mode }).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    if (!r.ok) {
      setBusy(false)
      setError(r.error)
      return
    }
    setForm(null)
    setDevice({ userCode: r.userCode, url: r.verificationUriComplete || r.verificationUri })
  }

  const via = (s: KiroStatusDto): string => {
    if (s.mode === 'api-key') return t('settings.providerSection.kiro.viaApiKey')
    if (s.mode === 'import') return t('settings.providerSection.kiro.viaImport', { source: s.importSource === 'kiro-ide' ? 'Kiro IDE' : 'Kiro CLI', provider: s.provider || '' })
    return s.provider || s.mode || ''
  }

  return (
    <div className="kiro-auth">
      {status?.signedIn ? (
        <div className="settings-row-desc">
          {t('settings.providerSection.kiro.signedIn', { via: via(status), region: status.region || 'us-east-1' })}
          {usage && typeof usage.used === 'number' && typeof usage.limit === 'number'
            ? ` · ${t('settings.providerSection.kiro.credits', { used: Math.round(usage.used), limit: Math.round(usage.limit) })}`
            : ''}
          {status.error ? ` · ${status.error}` : ''}
        </div>
      ) : (
        <div className="settings-row-desc">{t('settings.providerSection.kiro.signedOut')}</div>
      )}

      {device && (
        <div className="settings-row-desc kiro-device">
          {t('settings.providerSection.kiro.enterCode')} <strong className="kiro-code">{device.userCode}</strong>{' '}
          <a href={device.url} target="_blank" rel="noreferrer">
            {t('settings.providerSection.kiro.openPage')}
          </a>{' '}
          <button type="button" className="test-btn" onClick={() => void api.cancelLogin().then(() => (setDevice(null), setBusy(false)))}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {!device && (
        <div className="form-actions kiro-actions">
          {status?.signedIn ? (
            <button type="button" className="test-btn" disabled={busy} onClick={() => void run(() => api.signOut())}>
              {t('settings.providerSection.kiro.signOut')}
            </button>
          ) : (
            <>
              <Button type="button" disabled={busy} onClick={() => void startDevice('builder-id')}>
                {t('settings.providerSection.kiro.builderId')}
              </Button>
              <span
                style={{ fontSize: 'var(--font-xs)', color: 'var(--success)', fontWeight: 600, alignSelf: 'center' }}
              >
                ✓ {t('kiro.recommended')}
              </span>
              <button type="button" className="test-btn" disabled={busy} onClick={() => setForm(form === 'idc' ? null : 'idc')}>
                {t('settings.providerSection.kiro.idc')}
              </button>
              <button type="button" className="test-btn" disabled={busy} onClick={() => void run(() => api.importLogin('auto'), onSignedIn)}>
                {t('settings.providerSection.kiro.import')}
              </button>
              <button type="button" className="test-btn" disabled={busy} onClick={() => setForm(form === 'apiKey' ? null : 'apiKey')}>
                {t('settings.providerSection.kiro.apiKey')}
              </button>
            </>
          )}
        </div>
      )}

      {form === 'idc' && (
        <div className="add-form kiro-form">
          <Input placeholder="https://your-org.awsapps.com/start" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} />
          <Input placeholder="us-east-1" value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t('settings.providerSection.kiro.region')} />
          <Button type="button" disabled={busy || !startUrl.trim()} onClick={() => void startDevice('idc')}>
            {t('settings.providerSection.kiro.continue')}
          </Button>
        </div>
      )}
      {form === 'apiKey' && (
        <div className="add-form kiro-form">
          <Input type="password" placeholder="ksk_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoFocus />
          <Input placeholder="us-east-1" value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t('settings.providerSection.kiro.region')} />
          <Button type="button" disabled={busy || !apiKey.trim()} onClick={() => void run(() => api.setApiKey(apiKey.trim(), region.trim()), () => (setApiKey(''), onSignedIn?.()))}>
            {t('common.save')}
          </Button>
        </div>
      )}
      {error && (
        <div className="settings-row-desc kiro-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-row-desc kiro-note">{t('settings.providerSection.kiro.note')}</div>
    </div>
  )
}
