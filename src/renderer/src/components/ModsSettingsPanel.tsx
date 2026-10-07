import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deriveModCapabilities, deriveModRisk, getModRuntime, reloadMods, useModsUiStore } from '../agent/mods'
import { useAppStore } from '../stores/app'
import { useFocusTrap } from '../utils/focusTrap'
import ConfirmDialog from './ConfirmDialog'
import { IconFolder } from './icons'
import Button from './Button'
import Switch from './Switch'
import './ModsSettingsPanel.css'

interface ModRow {
  id: string
  name: string
  version: string
  description: string
  root: string
  source: string
  enabled: boolean
  consented: boolean
  consentStale: boolean
  tier: string
}

interface ModConsentEntry {
  name: string
  version: string
}

interface ModsSettings {
  enabled: boolean
  disableAllHooks: boolean
  disabledPlugins: string[]
  consentedPlugins: ModConsentEntry[] | null
  pluginDirs: string[]
  readClaudePlugins: boolean
}

interface ValidatePreview {
  name: string
  version: string
  root: string
  ok: boolean
  hooks: string[]
  calls: string[]
  findings: Array<{ severity: string; message: string }>
  text: string
}

const defaultSettings: ModsSettings = {
  enabled: true,
  disableAllHooks: false,
  disabledPlugins: [],
  consentedPlugins: [],
  pluginDirs: [],
  readClaudePlugins: false
}

export default function ModsSettingsPanel({ embedded }: { embedded?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const projectPath = useAppStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return p?.paths?.[0] || null
  })
  const sessionId = useAppStore((s) => s.activeSessionId || '')
  const runtimeGeneration = useModsUiStore((s) => s.runtimeGeneration)
  const [settings, setSettings] = useState<ModsSettings>(defaultSettings)
  const [mods, setMods] = useState<ModRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [consent, setConsent] = useState<ValidatePreview | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [claudeConfirm, setClaudeConfirm] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(Boolean(consent), dialogRef, { initialFocus: '.btn-cancel, .btn-primary' })

  const refresh = useCallback(async () => {
    const api = window.api?.mods
    if (!api) return
    const [s, list] = await Promise.all([
      api.settings().catch(() => defaultSettings),
      api.list(projectPath).catch(() => ({ ok: true, mods: [] as ModRow[] }))
    ])
    setSettings({ ...defaultSettings, ...s })
    setMods(Array.isArray(list?.mods) ? list.mods : [])
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh, runtimeGeneration])

  useEffect(() => {
    if (!consent) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setConsent(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [consent])

  const afterChange = async (): Promise<void> => {
    setBusy(true)
    try {
      await reloadMods({
        sessionId: sessionId || 'settings',
        cwd: projectPath || '',
        projectPath
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const patch = async (partial: Partial<ModsSettings>, opts?: { silent?: boolean }): Promise<ModsSettings | null> => {
    const next = await window.api?.mods?.setSettings(partial).catch(() => null)
    if (!next) {
      setMsg(t('settings.modsSection.saveFailed'))
      return null
    }
    setSettings({ ...defaultSettings, ...next })
    if (!opts?.silent) setMsg(t('settings.modsSection.saved'))
    await afterChange()
    return { ...defaultSettings, ...next }
  }

  const openConsent = async (mod: ModRow): Promise<void> => {
    const res = await window.api?.mods?.validate(mod.root).catch(() => null)
    if (!res?.report) {
      setMsg(t('settings.modsSection.validateFailed'))
      return
    }
    setShowAdvanced(false)
    setConsent({
      name: mod.name,
      version: mod.version,
      root: mod.root,
      ok: res.report.ok,
      hooks: res.report.hooks || [],
      calls: res.report.calls || [],
      findings: res.report.findings || [],
      text: res.text || ''
    })
  }

  const confirmConsent = async (): Promise<void> => {
    if (!consent) return
    const name = consent.name
    const version = consent.version || '0.0.0'
    const rest = (settings.consentedPlugins || []).filter((e) => e.name.toLowerCase() !== name.toLowerCase())
    const consented = [...rest, { name, version }]
    const disabled = settings.disabledPlugins.filter((n) => n.toLowerCase() !== name.toLowerCase())
    setConsent(null)
    await patch({ consentedPlugins: consented, disabledPlugins: disabled })
  }

  const revokeConsent = async (mod: ModRow): Promise<void> => {
    const consented = (settings.consentedPlugins || []).filter((e) => e.name.toLowerCase() !== mod.name.toLowerCase())
    const disabled = Array.from(new Set([...settings.disabledPlugins, mod.name]))
    await patch({ consentedPlugins: consented, disabledPlugins: disabled })
  }

  const togglePlugin = async (mod: ModRow, wantOn: boolean): Promise<void> => {
    if (wantOn && (!mod.consented || mod.consentStale)) {
      await openConsent(mod)
      return
    }
    const nextDisabled = wantOn
      ? settings.disabledPlugins.filter((n) => n.toLowerCase() !== mod.name.toLowerCase())
      : Array.from(new Set([...settings.disabledPlugins, mod.name]))
    await patch({ disabledPlugins: nextDisabled })
  }

  const addPluginDir = async (dir: string): Promise<void> => {
    const path = dir.trim()
    if (!path) return
    const dirs = Array.from(new Set([...settings.pluginDirs, path]))
    await patch({ pluginDirs: dirs })
  }

  const pickFolder = async (): Promise<void> => {
    const dir = await window.api?.selectFolder?.().catch(() => null)
    if (dir) await addPluginDir(dir)
  }

  const removePluginDir = async (dir: string): Promise<void> => {
    await patch({ pluginDirs: settings.pluginDirs.filter((d) => d !== dir) })
  }

  const installExample = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api?.mods?.installExample().catch(() => null)
      if (!res?.ok) {
        setMsg(res?.error || t('settings.modsSection.exampleFailed'))
        return
      }
      setMsg(t('settings.modsSection.exampleInstalled'))
      await refresh()
      const row = (await window.api?.mods?.list(projectPath))?.mods?.find((m) => m.name === 'first-mod')
      if (row) await openConsent(row as ModRow)
    } finally {
      setBusy(false)
    }
  }

  const capabilities = useMemo(
    () => (consent ? deriveModCapabilities(consent.hooks, consent.calls) : []),
    [consent]
  )
  const risk = useMemo(
    () => (consent ? deriveModRisk(consent.hooks, consent.calls) : 'low'),
    [consent]
  )

  const activeNames = useMemo(() => {
    void runtimeGeneration
    return new Set(getModRuntime().getActiveMods().map((m) => m.name))
  }, [runtimeGeneration])

  /** Mods that were consented but failed while loading (import error, hang). */
  const loadErrors = useMemo(() => {
    void runtimeGeneration
    const map = new Map<string, string>()
    for (const m of getModRuntime().getLoaded()) {
      if (m.error) map.set(m.name, m.error)
    }
    return map
  }, [runtimeGeneration])

  const activeMods = mods.filter((m) => m.enabled || activeNames.has(m.name))
  const installedMods = mods

  if (!window.api?.mods) {
    return <div className="settings-empty">{t('settings.modsSection.desktopOnly')}</div>
  }

  const masterOn = settings.enabled && !settings.disableAllHooks
  const runningNames = activeMods.map((m) => m.name).join(', ')
  const sessionText = runningNames
    ? t('settings.modsSection.sessionRunning', { names: runningNames })
    : t('settings.modsSection.sessionEmpty')

  return (
    <div className={`mods-settings ${embedded ? 'embedded' : ''}`}>
      {!embedded && (
        <>
          <h2>{t('settings.modsSection.title')}</h2>
          <p className="settings-desc">{t('settings.modsSection.desc')}</p>
        </>
      )}

      <div className="mods-trust-banner" role="note">
        <span className="mods-trust-mark" aria-hidden>
          <TrustMark />
        </span>
        <span className="mods-trust-copy">
          <strong>{t('settings.modsSection.trustTitle')}</strong>
          <span>{t('settings.modsSection.trustBody')}</span>
        </span>
      </div>

      <div className="settings-card mods-controls">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.modsSection.enabled')}</span>
            <span className="settings-row-desc">{t('settings.modsSection.enabledDesc')}</span>
          </div>
          <Switch
            checked={masterOn}
            onCheckedChange={(on) => {
              void patch(on ? { enabled: true, disableAllHooks: false } : { disableAllHooks: true })
            }}
            disabled={busy}
            aria-label={t('settings.modsSection.enabled')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.modsSection.readClaude')}</span>
            <span className="settings-row-desc">{t('settings.modsSection.readClaudeDesc')}</span>
          </div>
          <Switch
            checked={settings.readClaudePlugins}
            onCheckedChange={(on) => {
              if (on) {
                setClaudeConfirm(true)
                return
              }
              void patch({ readClaudePlugins: false })
            }}
            disabled={busy}
            aria-label={t('settings.modsSection.readClaude')}
          />
        </div>
        <div className="mods-session">
          <span className={`mods-session-dot ${activeMods.length > 0 && masterOn ? 'on' : ''}`} aria-hidden />
          <span className="mods-session-copy">
            <span className="mods-session-value" title={sessionText}>{sessionText}</span>
          </span>
          <button
            type="button"
            className="mods-quiet-btn"
            disabled={busy}
            onClick={() => void afterChange().then(() => setMsg(t('settings.modsSection.reloaded')))}
          >
            {t('settings.modsSection.reload')}
          </button>
        </div>
        {msg && <p className="mods-feedback" role="status">{msg}</p>}
      </div>

      {installedMods.length === 0 ? (
        <section className="mods-hero">
          <div className="mods-hero-mark" aria-hidden>
            <HeroMark />
          </div>
          <div className="mods-hero-copy">
            <h3>{t('settings.modsSection.onboarding')}</h3>
            <p>{t('settings.modsSection.onboardingDesc')}</p>
          </div>
          <div className="mods-actions">
            <Button type="button" disabled={busy} onClick={() => void installExample()}>
              {t('settings.modsSection.installExample')}
            </Button>
            <Button type="button" variant="secondary" className="mods-folder-btn" disabled={busy} onClick={() => void pickFolder()}>
              <IconFolder size={14} />
              {t('settings.modsSection.browseDir')}
            </Button>
          </div>
          <div className="mods-scan">
            <p>{t('settings.modsSection.scan.lead')}</p>
            <ul>
              <li><code>~/.pawn/mods</code></li>
              <li>{t('settings.modsSection.scan.extra')}</li>
              <li>{t('settings.modsSection.scan.claude')}</li>
              <li>
                {t('settings.modsSection.scan.project')} <code>.claude/plugins</code>
              </li>
            </ul>
          </div>
        </section>
      ) : (
        <section className="settings-card mods-list-card">
          <div className="mods-list-head">
            <div className="settings-row-info">
              <span className="settings-row-label">
                {t('settings.modsSection.installed')}
                <span className="mods-count">{installedMods.length}</span>
              </span>
              <span className="settings-row-desc">{t('settings.modsSection.installedDesc')}</span>
            </div>
            <button type="button" className="mods-quiet-btn" disabled={busy} onClick={() => void pickFolder()}>
              <IconFolder size={13} />
              {t('settings.modsSection.browseDir')}
            </button>
          </div>
          <div className="mods-tile-list">
            {installedMods.map((mod) => (
              <ModRowView
                key={mod.id}
                mod={mod}
                busy={busy}
                masterOn={masterOn}
                showRevoke={mod.consented}
                loadError={loadErrors.get(mod.name)}
                onReview={() => void openConsent(mod)}
                onToggle={(on) => void togglePlugin(mod, on)}
                onRevoke={() => void revokeConsent(mod)}
                t={t}
              />
            ))}
          </div>
          {settings.pluginDirs.length > 0 && (
            <div className="mods-dirs">
              <span className="mods-dirs-label">{t('settings.modsSection.pluginDirs')}</span>
              <ul className="mods-dir-list">
                {settings.pluginDirs.map((dir) => (
                  <li key={dir}>
                    <span className="plugin-source" title={dir}>{dir}</span>
                    <button type="button" className="mods-quiet-btn danger" disabled={busy} onClick={() => void removePluginDir(dir)}>
                      {t('common.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {consent && (
        <div className="mods-consent-backdrop" role="presentation" onClick={() => setConsent(null)}>
          <div
            ref={dialogRef}
            className="mods-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mods-consent-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mods-consent-title">{t('settings.modsSection.consentTitle', { name: consent.name })}</h3>
            <p className="settings-desc">{t('settings.modsSection.consentBody')}</p>
            <div className="mods-consent-meta">
              <span className="mods-version">{t('settings.modsSection.versionLabel', { version: consent.version })}</span>
              <span className={`mods-risk mods-risk-${risk}`}>{t(`settings.modsSection.risk.${risk}`)}</span>
            </div>
            <div className="mods-cap-list">
              {capabilities.length === 0 && (
                <span className="mods-cap-empty">{t('settings.modsSection.cap.none')}</span>
              )}
              {capabilities.map((cap) => (
                <span key={cap.id} className="mods-cap-chip">
                  {t(cap.labelKey)}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="mods-advanced-toggle"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {t('settings.modsSection.consentAdvanced')}
            </button>
            {showAdvanced && (
              <>
                <div className="mods-consent-block">
                  <span className="mods-consent-label">{t('settings.modsSection.consentHooks')}</span>
                  <code>{consent.hooks.join(', ') || '—'}</code>
                </div>
                <div className="mods-consent-block">
                  <span className="mods-consent-label">{t('settings.modsSection.consentCalls')}</span>
                  <code>{consent.calls.join(', ') || '—'}</code>
                </div>
              </>
            )}
            {consent.findings.length > 0 && (
              <ul className="mods-consent-findings">
                {consent.findings.map((f, i) => (
                  <li key={i} className={f.severity}>
                    {f.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="mods-consent-warn">{t('settings.modsSection.consentWarn')}</p>
            <div className="mods-consent-actions">
              <button type="button" className="btn-cancel" onClick={() => setConsent(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!consent.ok}
                onClick={() => void confirmConsent()}
              >
                {t('settings.modsSection.consentAllow')}
              </button>
            </div>
          </div>
        </div>
      )}

      {claudeConfirm && (
        <ConfirmDialog
          title={t('settings.modsSection.readClaude')}
          message={t('settings.modsSection.readClaudeConfirm')}
          confirmLabel={t('settings.modsSection.consentAllow')}
          cancelLabel={t('common.cancel')}
          danger={false}
          onConfirm={() => {
            setClaudeConfirm(false)
            void patch({ readClaudePlugins: true })
          }}
          onCancel={() => setClaudeConfirm(false)}
        />
      )}
    </div>
  )
}

function markOf(name: string): string {
  const parts = name.split(/[-_\s.]+/).filter(Boolean)
  const a = parts[0]?.[0] || '?'
  const b = parts[1]?.[0] || parts[0]?.[1] || ''
  return (a + b).toUpperCase()
}

function ModRowView({
  mod,
  busy,
  masterOn,
  showRevoke,
  loadError,
  onReview,
  onToggle,
  onRevoke,
  t
}: {
  mod: ModRow
  busy: boolean
  masterOn: boolean
  showRevoke?: boolean
  loadError?: string
  onReview: () => void
  onToggle: (on: boolean) => void
  onRevoke: () => void
  t: (key: string, opts?: Record<string, string>) => string
}): React.JSX.Element {
  const needsReview = !mod.consented || mod.consentStale
  return (
    <article className="mods-tile">
      <span className="mods-mark" aria-hidden>{markOf(mod.name)}</span>
      <div className="mods-tile-main">
        <div className="mods-tile-title">
          <strong>{mod.name}</strong>
          <span className="mods-version-inline">v{mod.version}</span>
        </div>
        {mod.description && <p className="mods-tile-desc">{mod.description}</p>}
        <div className="mods-tile-meta">
          <span className="plugin-kind">{mod.source}</span>
          <span className="plugin-source" title={mod.root}>{mod.root}</span>
        </div>
        <div className="mods-tile-badges">
          {mod.consentStale && <span className="mods-badge review">{t('settings.modsSection.needsReconsent')}</span>}
          {!mod.consented && !mod.consentStale && (
            <span className="mods-badge review">{t('settings.modsSection.needsReview')}</span>
          )}
          {mod.enabled && <span className="mods-badge on">{t('settings.modsSection.running')}</span>}
          {loadError && (
            <span className="mods-badge fail" title={loadError}>
              {t('settings.modsSection.loadFailed')}
            </span>
          )}
        </div>
      </div>
      <div className="mods-tile-actions">
        {needsReview ? (
          <button type="button" className="mods-quiet-btn accent" disabled={busy} onClick={onReview}>
            {t(mod.consentStale ? 'settings.modsSection.reReview' : 'settings.modsSection.review')}
          </button>
        ) : (
          <>
            {showRevoke && (
              <button type="button" className="mods-quiet-btn" disabled={busy} onClick={onRevoke}>
                {t('settings.modsSection.revoke')}
              </button>
            )}
            <Switch
              checked={mod.enabled}
              onCheckedChange={onToggle}
              disabled={busy || !masterOn}
              aria-label={mod.name}
            />
          </>
        )}
      </div>
    </article>
  )
}

function TrustMark(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 3v6c0 4.5-2.8 7.4-7 9-4.2-1.6-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function HeroMark(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <path d="M17 13v8M13 17h8" />
    </svg>
  )
}
