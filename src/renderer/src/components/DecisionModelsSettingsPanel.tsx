import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDecisionStore } from '../stores/decision'
import ConfirmDialog from './ConfirmDialog'

type Kind = DecisionProviderKindDto

interface Preset {
  kind: Kind
  name: string
  baseUrl: string
  model: string
  keyRequired: boolean
  models: string[]
  descKey: string
  hintKey: string
  link?: { href: string; labelKey: string }
}

/** Mirrors DECISION_PRESETS in src/main/decision/types.ts (main validates). */
const PRESETS: Preset[] = [
  {
    kind: 'typesafe',
    name: 'TypeSafe',
    baseUrl: 'https://api.typesafe.ai',
    model: 'jev-latest',
    keyRequired: true,
    models: ['jev-latest', 'jev-preview', 'jev-1.13.0'],
    descKey: 'settings.decisionSection.presets.typesafe',
    hintKey: 'settings.decisionSection.hints.typesafe',
    link: { href: 'https://console.typesafe.ai', labelKey: 'settings.decisionSection.getKey' }
  },
  {
    kind: 'ollaya',
    name: 'Ollaya',
    baseUrl: 'http://localhost:11435',
    model: 'laya',
    keyRequired: false,
    models: ['laya', 'laya:multilingual', 'winnow:e4b', 'decider:4b', 'kev:4b', 'nli', 'gliclass'],
    descKey: 'settings.decisionSection.presets.ollaya',
    hintKey: 'settings.decisionSection.hints.ollaya',
    link: { href: 'https://ollaya.dev/download', labelKey: 'settings.decisionSection.getOllaya' }
  },
  {
    kind: 'custom',
    name: 'Custom',
    baseUrl: '',
    model: '',
    keyRequired: false,
    models: [],
    descKey: 'settings.decisionSection.presets.custom',
    hintKey: 'settings.decisionSection.hints.custom'
  }
]

const presetOf = (kind: Kind): Preset => PRESETS.find((p) => p.kind === kind) ?? PRESETS[2]

interface FormState {
  id?: string
  kind: Kind
  name: string
  baseUrl: string
  /** Typed key; empty while editing keeps the stored one. */
  apiKey: string
  clearKey: boolean
  hasKey: boolean
  model: string
}

type TestState = { ok: boolean; text: string }

const FEATURES: Array<{ key: keyof DecisionFeaturesDto; label: string; desc: string }> = [
  { key: 'agentTool', label: 'settings.decisionSection.features.agentTool', desc: 'settings.decisionSection.features.agentToolDesc' },
  {
    key: 'shellRiskGuard',
    label: 'settings.decisionSection.features.shellRiskGuard',
    desc: 'settings.decisionSection.features.shellRiskGuardDesc'
  },
  {
    key: 'routerAssist',
    label: 'settings.decisionSection.features.routerAssist',
    desc: 'settings.decisionSection.features.routerAssistDesc'
  }
]

export default function DecisionModelsSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { status, available, refresh, saveProvider, removeProvider, setEnabled, setFeatures } = useDecisionStore()
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [models, setModels] = useState<string[]>([])
  const [modelsState, setModelsState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [modelsError, setModelsError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<DecisionProviderDto | null>(null)
  const [rowError, setRowError] = useState('')
  const uid = useId()

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!available) {
    return (
      <div className="settings-section">
        <h2>{t('settings.decisionSection.title')}</h2>
        <p className="settings-desc">{t('settings.decisionSection.desc')}</p>
        <div className="settings-empty">{t('settings.decisionSection.desktopOnly')}</div>
      </div>
    )
  }

  const providers = status?.providers ?? []
  const active = status?.active ?? null
  const features = status?.features

  const openAdd = (kind: Kind): void => {
    const p = presetOf(kind)
    setForm({ kind, name: p.kind === 'custom' ? '' : p.name, baseUrl: p.baseUrl, apiKey: '', clearKey: false, hasKey: false, model: p.model })
    setModels(p.models)
    setModelsState('idle')
    setModelsError('')
    setFormError('')
  }

  const loadModels = async (id: string, fallback: string[]): Promise<void> => {
    const d = window.api.decision
    if (!d) return
    setModelsState('loading')
    setModelsError('')
    const r = await d.models(id).catch((e: unknown) => ({ ok: false as const, error: String(e) }))
    if (r.ok) {
      const names = r.models.map((m) => m.name)
      setModels(names.length ? names : fallback)
      setModelsState('idle')
    } else {
      setModels(fallback)
      setModelsState('error')
      setModelsError(r.error)
    }
  }

  const openEdit = (p: DecisionProviderDto): void => {
    setForm({ id: p.id, kind: p.kind, name: p.name, baseUrl: p.baseUrl, apiKey: '', clearKey: false, hasKey: p.hasKey, model: p.model })
    setFormError('')
    const fallback = presetOf(p.kind).models
    setModels(fallback)
    void loadModels(p.id, fallback)
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setFormError('')
    try {
      const r = await saveProvider({
        id: form.id,
        kind: form.kind,
        name: form.name.trim() || undefined,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        // Editing: empty keeps the stored key unless "remove key" is ticked.
        apiKey: form.apiKey.trim() ? form.apiKey.trim() : form.clearKey ? '' : form.id ? undefined : ''
      })
      if (!r.ok) {
        setFormError(r.error || t('common.error'))
        return
      }
      setForm(null)
      if (r.id) void runTest(r.id)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async (id: string): Promise<void> => {
    const d = window.api.decision
    if (!d) return
    setTesting(id)
    try {
      const r = await d.test(id)
      if (r.ok) {
        setTests((s) => ({
          ...s,
          [id]: { ok: true, text: t('settings.decisionSection.testOk', { model: r.model, ms: r.latencyMs }) }
        }))
      } else {
        setTests((s) => ({ ...s, [id]: { ok: false, text: r.error } }))
      }
    } catch (err) {
      setTests((s) => ({ ...s, [id]: { ok: false, text: String(err) } }))
    } finally {
      setTesting(null)
    }
  }

  const toggleActive = async (p: DecisionProviderDto, on: boolean): Promise<void> => {
    setRowError('')
    const r = await setEnabled(p.id, on)
    if (!r.ok && r.error) setRowError(r.error)
  }

  const preset = form ? presetOf(form.kind) : null
  // Main rejects plain http to public hosts, so an http URL here is local / private network.
  const localForm = form
    ? /^http:\/\//i.test(form.baseUrl.trim()) || /^https:\/\/(localhost|127\.|\[::1\])/i.test(form.baseUrl.trim())
    : false
  const keyRequired = !!preset?.keyRequired && !localForm

  return (
    <div className="settings-section decision-settings">
      <h2>{t('settings.decisionSection.title')}</h2>
      <p className="settings-desc">{t('settings.decisionSection.desc')}</p>

      <div className="settings-card">
        {providers.map((p) => {
          const test = tests[p.id]
          return (
            <div key={p.id} className="settings-row provider-row">
              <div className="settings-row-info">
                <span className="settings-row-label decision-provider-name">
                  {p.name}
                  <span className="settings-badge">{p.local ? t('settings.decisionSection.local') : t('settings.decisionSection.hosted')}</span>
                  {p.enabled && <span className="settings-badge decision-active-badge">{t('settings.decisionSection.active')}</span>}
                </span>
                <span className="settings-row-desc">
                  <code>{p.model}</code> · {p.baseUrl}
                  {p.hasKey && p.keyHint ? ` · ${t('settings.decisionSection.keySaved', { hint: p.keyHint })}` : ''}
                </span>
                {test && (
                  <span className={`settings-row-desc decision-test-result ${test.ok ? 'ok' : 'fail'}`} role="status">
                    {test.text}
                  </span>
                )}
              </div>
              <div className="settings-row-actions">
                <button
                  type="button"
                  className={`test-btn ${test ? (test.ok ? 'ok' : 'fail') : ''}`}
                  onClick={() => void runTest(p.id)}
                  disabled={testing === p.id}
                >
                  {testing === p.id ? t('settings.decisionSection.testing') : t('settings.decisionSection.test')}
                </button>
                <button type="button" className="test-btn" onClick={() => openEdit(p)}>
                  {t('settings.decisionSection.edit')}
                </button>
                <label className="toggle-switch" title={t('settings.decisionSection.activeHint')}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    aria-label={t('settings.decisionSection.useProvider', { name: p.name })}
                    onChange={(e) => void toggleActive(p, e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
                <button
                  type="button"
                  className="delete-btn"
                  aria-label={t('settings.decisionSection.remove', { name: p.name })}
                  title={t('settings.decisionSection.remove', { name: p.name })}
                  onClick={() => setConfirmRemove(p)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
        {providers.length === 0 && <div className="settings-empty">{t('settings.decisionSection.empty')}</div>}
        {rowError && <div className="decision-error" role="alert">{rowError}</div>}
      </div>

      {!form && (
        <div className="preset-section">
          <div className="settings-row-desc preset-section-label">{t('settings.decisionSection.addDesc')}</div>
          <div className="decision-preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.kind}
                type="button"
                className={`decision-preset${p.kind === 'typesafe' ? ' recommended' : ''}`}
                onClick={() => openAdd(p.kind)}
              >
                <span className="decision-preset-name">
                  {p.kind === 'custom' ? t('settings.decisionSection.customName') : p.name}
                  {p.kind === 'typesafe' && <span className="decision-preset-tag">{t('settings.decisionSection.recommended')}</span>}
                  {p.kind === 'ollaya' && <span className="decision-preset-tag local">{t('settings.decisionSection.local')}</span>}
                </span>
                <span className="decision-preset-desc">{t(p.descKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {form && preset && (
        <form className="settings-card add-form decision-form" onSubmit={(e) => void submit(e)}>
          <div className="settings-row-label">
            {form.id
              ? t('settings.decisionSection.editTitle', { name: form.name || preset.name })
              : t('settings.decisionSection.addTitle', { name: form.kind === 'custom' ? t('settings.decisionSection.customName') : preset.name })}
          </div>
          <div className="settings-row-desc">
            {t(preset.hintKey)}
            {preset.link && (
              <>
                {' '}
                <a href={preset.link.href} target="_blank" rel="noopener noreferrer">
                  {t(preset.link.labelKey)}
                </a>
              </>
            )}
          </div>

          <label className="decision-field" htmlFor={`${uid}-name`}>
            <span>{t('settings.decisionSection.fields.name')}</span>
            <input
              id={`${uid}-name`}
              value={form.name}
              placeholder={preset.kind === 'custom' ? t('settings.decisionSection.fields.namePlaceholder') : preset.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="decision-field" htmlFor={`${uid}-url`}>
            <span>{t('settings.decisionSection.fields.baseUrl')}</span>
            <input
              id={`${uid}-url`}
              value={form.baseUrl}
              placeholder={preset.baseUrl || 'https://decisions.example.com'}
              spellCheck={false}
              required
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>

          <label className="decision-field" htmlFor={`${uid}-key`}>
            <span>
              {t('settings.decisionSection.fields.apiKey')}
              {!keyRequired && <em className="decision-optional"> {t('settings.decisionSection.fields.optional')}</em>}
            </span>
            <input
              id={`${uid}-key`}
              type="password"
              autoComplete="off"
              value={form.apiKey}
              required={keyRequired && !form.hasKey}
              placeholder={
                form.hasKey && !form.clearKey
                  ? t('settings.decisionSection.fields.apiKeyKeep')
                  : keyRequired
                    ? t('settings.decisionSection.fields.apiKeyPlaceholder')
                    : t('settings.decisionSection.fields.apiKeyLocal')
              }
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
          {form.hasKey && (
            <label className="decision-check">
              <input type="checkbox" checked={form.clearKey} onChange={(e) => setForm({ ...form, clearKey: e.target.checked, apiKey: '' })} />
              <span>{t('settings.decisionSection.fields.clearKey')}</span>
            </label>
          )}

          <label className="decision-field" htmlFor={`${uid}-model`}>
            <span>{t('settings.decisionSection.fields.model')}</span>
            <span className="decision-model-row">
              <input
                id={`${uid}-model`}
                value={form.model}
                list={`${uid}-models`}
                placeholder={preset.model || 'model-name'}
                spellCheck={false}
                required
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
              {form.id && (
                <button
                  type="button"
                  className="test-btn"
                  disabled={modelsState === 'loading'}
                  onClick={() => void loadModels(form.id!, preset.models)}
                >
                  {modelsState === 'loading' ? t('common.loading') : t('settings.decisionSection.fields.loadModels')}
                </button>
              )}
            </span>
            <datalist id={`${uid}-models`}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {modelsState === 'error' && <div className="settings-row-desc decision-test-result fail">{modelsError}</div>}

          <div className="settings-row-desc decision-privacy">
            {localForm ? t('settings.decisionSection.privacyLocal') : t('settings.decisionSection.privacyHosted')}
          </div>
          {formError && <div className="decision-error" role="alert">{formError}</div>}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {form.id ? t('common.save') : t('settings.decisionSection.addAndTest')}
            </button>
            <button type="button" className="btn-cancel" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      <h3 className="decision-subtitle">{t('settings.decisionSection.harnessTitle')}</h3>
      <p className="settings-desc">
        {active
          ? t('settings.decisionSection.harnessDesc', { name: active.name, model: active.model })
          : t('settings.decisionSection.harnessInactive')}
      </p>
      <div className={`settings-card${active ? '' : ' decision-disabled'}`}>
        {FEATURES.map((f) => (
          <div key={f.key} className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{t(f.label)}</span>
              <span className="settings-row-desc">{t(f.desc)}</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={!!features?.[f.key]}
                disabled={!active}
                aria-label={t(f.label)}
                onChange={(e) => {
                  setRowError('')
                  setFeatures({ [f.key]: e.target.checked }).catch(() => setRowError(t('common.operationFailed')))
                }}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        ))}
      </div>
      {active && (
        <p className="settings-desc decision-privacy">
          {active.local ? t('settings.decisionSection.privacyLocal') : t('settings.decisionSection.privacyActiveHosted', { name: active.name })}
        </p>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('settings.decisionSection.remove', { name: confirmRemove.name })}
          message={t('settings.decisionSection.removeConfirm')}
          confirmLabel={t('confirmDialog.confirm')}
          cancelLabel={t('confirmDialog.cancel')}
          onConfirm={() => {
            const id = confirmRemove.id
            setConfirmRemove(null)
            void removeProvider(id)
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}
