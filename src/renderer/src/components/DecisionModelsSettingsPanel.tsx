import { useEffect, useId, useState } from 'react'
import { tx } from '../i18n'
import { Trash2 } from 'lucide-react'
import { useDecisionStore } from '../stores/decision'
import ConfirmDialog from './ConfirmDialog'
import Button from './Button'
import Input from './Input'

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
        <h2>{'Decision models'}</h2>
        <p className="settings-desc">{'Optional. A decision model answers typed questions (pick one, score, yes or no) with calibrated probabilities in milliseconds instead of writing text. Pawn works the same without one; with one, the agent makes faster, cheaper judgments.'}</p>
        <div className="settings-empty">{'Decision models are available in the desktop app.'}</div>
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
        setFormError(r.error || 'Error')
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
          [id]: { ok: true, text: `Works · ${r.model} · answered in ${r.latencyMs} ms` }
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
      <h2>{'Decision models'}</h2>
      <p className="settings-desc">{'Optional. A decision model answers typed questions (pick one, score, yes or no) with calibrated probabilities in milliseconds instead of writing text. Pawn works the same without one; with one, the agent makes faster, cheaper judgments.'}</p>

      <div className="settings-card">
        {providers.map((p) => {
          const test = tests[p.id]
          return (
            <div key={p.id} className="settings-row provider-row">
              <div className="settings-row-info">
                <span className="settings-row-label decision-provider-name">
                  {p.name}
                  <span className="settings-badge">{p.local ? 'Local' : 'Hosted'}</span>
                  {p.enabled && <span className="settings-badge decision-active-badge">{'In use'}</span>}
                </span>
                <span className="settings-row-desc">
                  <code>{p.model}</code> · {p.baseUrl}
                  {p.hasKey && p.keyHint ? ` · ${tx('settings.decisionSection.keySaved', { hint: p.keyHint })}` : ''}
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
                  {testing === p.id ? 'Testing…' : 'Test'}
                </button>
                <button type="button" className="test-btn" onClick={() => openEdit(p)}>
                  {'Edit'}
                </button>
                <label className="toggle-switch" title={'Use this provider. Only one decision model is active at a time.'}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    aria-label={`Use ${p.name}`}
                    onChange={(e) => void toggleActive(p, e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
                <button
                  type="button"
                  className="delete-btn"
                  aria-label={`Remove ${p.name}`}
                  title={`Remove ${p.name}`}
                  onClick={() => setConfirmRemove(p)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </div>
          )
        })}
        {providers.length === 0 && <div className="settings-empty">{'No decision model yet. Add TypeSafe for hosted Jev, or Ollaya to run open models on this machine.'}</div>}
        {rowError && <div className="decision-error" role="alert">{rowError}</div>}
      </div>

      {!form && (
        <div className="preset-section">
          <div className="settings-row-desc preset-section-label">{'Add a provider'}</div>
          <div className="decision-preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.kind}
                type="button"
                className={`decision-preset${p.kind === 'typesafe' ? ' recommended' : ''}`}
                onClick={() => openAdd(p.kind)}
              >
                <span className="decision-preset-name">
                  {p.kind === 'custom' ? 'Custom' : p.name}
                  {p.kind === 'typesafe' && <span className="decision-preset-tag">{'Recommended'}</span>}
                  {p.kind === 'ollaya' && <span className="decision-preset-tag local">{'Local'}</span>}
                </span>
                <span className="decision-preset-desc">{tx(p.descKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {form && preset && (
        <form className="settings-card add-form decision-form" onSubmit={(e) => void submit(e)}>
          <div className="settings-row-label">
            {form.id
              ? `Edit ${form.name || preset.name}`
              : `Add ${form.kind === 'custom' ? 'Custom' : preset.name}`}
          </div>
          <div className="settings-row-desc">
            {tx(preset.hintKey)}
            {preset.link && (
              <>
                {' '}
                <a href={preset.link.href} target="_blank" rel="noopener noreferrer">
                  {tx(preset.link.labelKey)}
                </a>
              </>
            )}
          </div>

          <label className="decision-field" htmlFor={`${uid}-name`}>
            <span>{'Name'}</span>
            <Input
              id={`${uid}-name`}
              value={form.name}
              placeholder={preset.kind === 'custom' ? 'My decision server' : preset.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="decision-field" htmlFor={`${uid}-url`}>
            <span>{'Base URL'}</span>
            <Input
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
              {'API key'}
              {!keyRequired && <em className="decision-optional"> {'(optional)'}</em>}
            </span>
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="off"
              value={form.apiKey}
              required={keyRequired && !form.hasKey}
              placeholder={
                form.hasKey && !form.clearKey
                  ? 'Saved — leave empty to keep it'
                  : keyRequired
                    ? 'Paste your API key'
                    : 'Not needed for a local server'
              }
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
          {form.hasKey && (
            <label className="decision-check">
              <input type="checkbox" checked={form.clearKey} onChange={(e) => setForm({ ...form, clearKey: e.target.checked, apiKey: '' })} />
              <span>{'Remove the saved key'}</span>
            </label>
          )}

          <label className="decision-field" htmlFor={`${uid}-model`}>
            <span>{'Model'}</span>
            <span className="decision-model-row">
              <Input
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
                  {modelsState === 'loading' ? 'Loading…' : 'Load models'}
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
            {localForm ? 'Decisions run on this machine or your network. Nothing goes to a cloud service.' : 'Decision requests go to this provider. Pawn redacts secrets such as API keys and tokens first.'}
          </div>
          {formError && <div className="decision-error" role="alert">{formError}</div>}
          <div className="form-actions">
            <Button type="submit" disabled={saving}>
              {form.id ? 'Save' : 'Add and test'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setForm(null)}>
              {'Cancel'}
            </Button>
          </div>
        </form>
      )}

      <h3 className="decision-subtitle">{'How the agent uses it'}</h3>
      <p className="settings-desc">
        {active
          ? `Pawn uses ${active.name} (${active.model}) in the places below. Each one falls back to normal behavior when the model is slow or unreachable.`
          : 'Turn on a decision model above to use these.'}
      </p>
      <div className={`settings-card${active ? '' : ' decision-disabled'}`}>
        {FEATURES.map((f) => (
          <div key={f.key} className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{tx(f.label)}</span>
              <span className="settings-row-desc">{tx(f.desc)}</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={!!features?.[f.key]}
                disabled={!active}
                aria-label={tx(f.label)}
                onChange={(e) => {
                  setRowError('')
                  setFeatures({ [f.key]: e.target.checked }).catch(() => setRowError('Something failed — see the console for details.'))
                }}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        ))}
      </div>
      {active && (
        <p className="settings-desc decision-privacy">
          {active.local ? 'Decisions run on this machine or your network. Nothing goes to a cloud service.' : `Decision requests go to ${active.name}. Pawn redacts secrets such as API keys and tokens first, and keeps the key encrypted on this device.`}
        </p>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${confirmRemove.name}`}
          message={'Remove this decision model? Its saved API key is deleted from this device.'}
          confirmLabel={'Confirm'}
          cancelLabel={'Cancel'}
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
