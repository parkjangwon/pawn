import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus, Search, Trash2 } from 'lucide-react'
import { PROVIDER_PRESETS, type ProviderPreset } from '../agent/providerPresets'
import { groupPresets, isPresetRegistered, providerInitials } from './providerGrid'
import './ProvidersSettingsPanel.css'
import { isOpenRouterProvider } from '../agent/listModels'
import type { ApiFormat } from '../types/provider'
import type { SettingsState } from './settingsState'
import KiroAuthPanel from './KiroAuthPanel'
import XaiAuthPanel from './XaiAuthPanel'
import SubscriptionAuthPanel from './SubscriptionAuthPanel'
import { isXaiHost } from '../agent/xaiSession'
import { isAntigravityBase, isChatGptCodexBase, isClaudeApiBase } from '../agent/subscriptionWire'
import Button from './Button'
import Input from './Input'
import Select from './Select'
import Switch from './Switch'
import { tx } from '../i18n'
import { DEFAULT_OLLAMA_URL, isOllamaProvider, ollamaApiBase, validateOllamaUrl } from '../agent/ollamaEndpoint'

function OllamaEndpointEditor({ baseUrl, onSave }: { baseUrl: string; onSave: (baseUrl: string) => void }): React.JSX.Element {
  const [value, setValue] = useState(baseUrl.replace(/\/v1\/?$/i, ''))
  const [error, setError] = useState('')
  return (
    <div className="ollama-endpoint provider-field">
      <span className="provider-field-label">{'Endpoint'}</span>
      <div className="provider-field-row">
      <Input aria-label="Endpoint" placeholder="http://192.168.0.10:11434" value={value} onChange={(e) => { setValue(e.target.value); setError('') }} />
      <Button className="settings-btn-secondary"
        variant="secondary"
        onClick={() => {
          const v = validateOllamaUrl(value)
          if (v.ok) onSave(ollamaApiBase(v.url))
          else setError(v.error)
        }}
      >
        {'Save'}
      </Button>
      </div>
      {error && <div className="settings-form-error" role="alert">{error}</div>}
    </div>
  )
}

export default function ProvidersSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    providers,
    syncResult,
    syncFailed,
    handleSyncModels,
    syncingId,
    testResult,
    handleTestProvider,
    testingId,
    updateProvider,
    setConfirmDelete,
    setPresetPicking,
    setPresetKey,
    presetPicking,
    presetKey,
    presetKeyError,
    setPresetKeyError,
    ollamaUrl,
    setOllamaUrl,
    formError,
    setFormError,
    handleAddFromPreset,
    showAddProvider,
    form,
    setForm,
    handleAddProvider,
    setShowAddProvider
  } = state
  const plaintext = usePlaintextSecretStorage()
  const ollamaUrlCheck = validateOllamaUrl(ollamaUrl)

  const [query, setQuery] = useState('')
  const groups = groupPresets(PROVIDER_PRESETS, query)
  const pickPreset = (preset: ProviderPreset): void => {
    setPresetPicking(preset); setPresetKey(''); setOllamaUrl(DEFAULT_OLLAMA_URL); if (presetKeyError) setPresetKeyError('')
  }

  return (
    <div className="settings-section providers-panel">
      <h2>{'Providers'}</h2>
      <p className="settings-desc">{'Manage AI provider connections'}</p>
      {plaintext && <SecretStorageWarningBanner />}
      <div className="provider-card-list">
        {providers.map((p) => {
          const isOpenRouter = isOpenRouterProvider(p)
          const noCatalog = isChatGptCodexBase(p.baseUrl) || isAntigravityBase(p.baseUrl)
          const test = testResult[p.id]
          const hasAuth = p.apiFormat === 'kiro' || isXaiHost(p.baseUrl) || isChatGptCodexBase(p.baseUrl) || isClaudeApiBase(p.baseUrl) || isAntigravityBase(p.baseUrl) || isOllamaProvider(p)
          return (
            <section key={p.id} className="provider-card provider-row" aria-label={p.name}>
              <div className="provider-card-head">
                <ProviderMark name={p.name} muted={!p.enabled} />
                <div className="provider-card-title">
                  <span className="provider-card-name">{p.name}</span>
                  <span className="provider-card-endpoint" title={`${p.apiFormat} / ${p.baseUrl}`}>
                    {p.apiFormat} · {p.baseUrl}
                  </span>
                </div>
                {test && (
                  <span className={`provider-status ${test.ok ? 'ok' : 'fail'}`} data-testid="provider-status">
                    {test.ok ? 'Connected' : 'Failed'}
                  </span>
                )}
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(v) => updateProvider(p.id, { enabled: v })}
                  aria-label={`Enable ${p.name}`}
                />
                <button
                  type="button"
                  className="delete-btn provider-delete"
                  aria-label={'Delete' + ': ' + p.name}
                  onClick={() => setConfirmDelete({ type: 'provider', id: p.id, name: p.name })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {hasAuth && (
                <div className="provider-card-body">
                  {p.apiFormat === 'kiro' && <KiroAuthPanel onSignedIn={() => void handleSyncModels(p.id)} />}
                  {isXaiHost(p.baseUrl) && <XaiAuthPanel onSignedIn={() => void handleSyncModels(p.id)} />}
                  {isChatGptCodexBase(p.baseUrl) && <SubscriptionAuthPanel kind="chatgpt" />}
                  {isClaudeApiBase(p.baseUrl) && <SubscriptionAuthPanel kind="claude" onSignedIn={() => void handleSyncModels(p.id)} />}
                  {isAntigravityBase(p.baseUrl) && <SubscriptionAuthPanel kind="antigravity" />}
                  {isOllamaProvider(p) && <OllamaEndpointEditor baseUrl={p.baseUrl} onSave={(baseUrl) => updateProvider(p.id, { baseUrl })} />}
                </div>
              )}
              <div className="provider-card-foot">
                <div className="provider-card-actions">
                  {noCatalog ? null : !isOpenRouter ? (
                    <Button
                      variant="secondary"
                      className="settings-btn-secondary provider-action"
                      onClick={() => handleSyncModels(p.id)}
                      disabled={syncingId === p.id}
                      title={'Fetch the live model catalog from GET {baseUrl}/models and merge it into your list'}
                    >
                      {syncingId === p.id ? 'Loading…' : 'Sync models'}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      className="settings-btn-secondary provider-action"
                      disabled
                      title={'OpenRouter offers hundreds of models; please register specific models manually to prevent clutter.'}
                    >
                      {'Manual add only'}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className={`settings-btn-secondary provider-action${test?.ok ? ' ok' : test ? ' fail' : ''}`}
                    onClick={() => handleTestProvider(p.id)}
                    disabled={testingId === p.id}
                  >
                    {testingId === p.id ? 'Loading…' : 'Test connection'}
                  </Button>
                </div>
                {syncResult[p.id] && (
                  <span
                    className={`provider-card-meta sync-result${syncFailed[p.id] ? ' provider-sync-warn' : ''}`}
                    title={syncResult[p.id]}
                  >
                    {syncResult[p.id]}
                  </span>
                )}
              </div>
              {test && (
                <div className={'provider-test-line' + (test.ok ? ' test-ok' : ' provider-test-fail')} role="status">
                  {test.ok ? '✓ ' + 'Connected' : '✗ ' + test.message}
                </div>
              )}
            </section>
          )
        })}
        {providers.length === 0 && <div className="settings-empty provider-card-empty">{'No providers configured'}</div>}
      </div>

      <div className="preset-section">
        <div className="provider-known-head">
          <div className="preset-section-label">{'Well-known providers — paste an API key and go. Model lists refresh from each provider’s API when possible.'}</div>
          <div className="provider-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label={'Search providers'}
              placeholder={'Search providers'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {groups.map((g) => (
          <div key={g.id} className="provider-group" data-group={g.id}>
            <div className="provider-group-head">
              <span className="provider-group-label">{g.label}</span>
              <span className="provider-group-hint">{g.hint}</span>
            </div>
            <div className="provider-tile-grid">
              {g.items.map((preset) => {
                const isAlreadyAdded = isPresetRegistered(preset, providers)
                const isRecommended = ['anthropic', 'openai', 'deepseek'].includes(preset.id.toLowerCase())
                const active = presetPicking?.id === preset.id
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={`provider-tile${isAlreadyAdded ? ' registered' : ''}${active ? ' active' : ''}`}
                    onClick={() => pickPreset(preset)}
                    disabled={isAlreadyAdded}
                    aria-pressed={active}
                    title={isAlreadyAdded ? `${preset.name} — already added` : preset.baseUrl}
                  >
                    <ProviderMark name={preset.name} />
                    <span className="provider-tile-name">{preset.name}</span>
                    {isAlreadyAdded ? (
                      <span className="provider-tile-check" aria-label="Added" data-testid="provider-registered">
                        <Check size={12} aria-hidden="true" />
                      </span>
                    ) : isRecommended ? (
                      <span className="preset-recommended-tag" aria-label="Recommended">★</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="provider-search-empty">{`No providers match “${query.trim()}”`}</div>}
        {presetPicking && (
          <div className="provider-form preset-form">
            <div className="provider-form-head">
              <ProviderMark name={presetPicking.name} />
              <div className="provider-card-title">
                <span className="provider-card-name">{presetPicking.name}</span>
                <span className="provider-card-endpoint">{presetPicking.baseUrl}</span>
              </div>
            </div>
            <p className="provider-form-hint">
              {presetPicking.keyHintKey ? tx(presetPicking.keyHintKey) : presetPicking.keyHint}
            </p>
            {presetPicking.id === 'ollama' && (
              <label className="provider-field">
                <span className="provider-field-label">{'Endpoint'}</span>
                <Input
                  aria-label="Ollama base URL"
                  placeholder="http://192.168.0.10:11434"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                />
                {!ollamaUrlCheck.ok && (
                  <div className="settings-form-error" role="alert">{ollamaUrlCheck.error}</div>
                )}
              </label>
            )}
            {!presetPicking.localNoKey && !presetPicking.signIn && (
              <label className="provider-field">
                <span className="provider-field-label">{'API key'}</span>
                <Input
                  type="password"
                  placeholder={
                    presetPicking.optionalKey
                      ? 'API key (optional if you sign in)'
                      : 'Paste your API key'
                  }
                  value={presetKey}
                  onChange={(e) => {
                    setPresetKey(e.target.value)
                    if (presetKeyError) setPresetKeyError('')
                  }}
                  autoFocus
                />
                {presetKeyError && (
                  <div className="settings-form-error" role="alert">{presetKeyError}</div>
                )}
              </label>
            )}
            <div className="form-actions">
              <Button className="settings-btn-secondary" variant="secondary" onClick={() => setPresetPicking(null)}>{'Cancel'}</Button>
              <Button className="settings-btn-primary"
                onClick={() => handleAddFromPreset(presetPicking, presetKey)}
                disabled={(presetPicking.id === 'ollama' && !ollamaUrlCheck.ok) || (!presetPicking.localNoKey && !presetPicking.signIn && !presetPicking.optionalKey && !presetKey.trim())}
              >
                {`Add (includes ${presetPicking.models.length} models)`}
              </Button>
            </div>
          </div>
        )}
      </div>

      {showAddProvider ? (
        <form
          className="provider-form add-form"
          onSubmit={(e) => {
            e.preventDefault()
            void handleAddProvider()
          }}
        >
          <div className="provider-form-head">
            <span className="provider-card-name">{'Add custom provider'}</span>
          </div>
          <label className="provider-field">
            <span className="provider-field-label">{'Name'}</span>
            <Input placeholder={'My provider'} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (formError) setFormError('') }} />
          </label>
          <label className="provider-field">
            <span className="provider-field-label">{'API format'}</span>
            <Select aria-label={'My provider'} value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}>
              <option value="openai">{'OpenAI'}</option>
              <option value="claude">{'Claude'}</option>
              <option value="kiro">Kiro</option>
            </Select>
          </label>
          <label className="provider-field">
            <span className="provider-field-label">{'Base URL'}</span>
            <Input placeholder={'https://api.example.com'} value={form.baseUrl} onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); if (formError) setFormError('') }} />
          </label>
          <label className="provider-field">
            <span className="provider-field-label">{'API key'}</span>
            <Input type="password" placeholder={'sk-…'} value={form.apiKey} onChange={(e) => { setForm({ ...form, apiKey: e.target.value }); if (formError) setFormError('') }} />
          </label>
          {formError && <div className="settings-form-error" role="alert">{formError}</div>}
          <div className="form-actions">
            <Button className="settings-btn-secondary" variant="secondary" type="button" onClick={() => setShowAddProvider(false)}>{'Cancel'}</Button>
            <Button className="settings-btn-primary" type="submit">{'Save'}</Button>
          </div>
        </form>
      ) : (
        <button type="button" className="add-btn-full provider-add-custom" onClick={() => setShowAddProvider(true)}>
          <Plus size={14} aria-hidden="true" />
          <span>{'Add custom provider'}</span>
        </button>
      )}
    </div>
  )
}

/** Provider icon. No provider logos ship with Pawn, so this is the initials fallback. */
export function ProviderMark({ name, muted }: { name: string; muted?: boolean }): React.JSX.Element {
  return (
    <span className={`provider-mark${muted ? ' muted' : ''}`} aria-hidden="true" data-testid="provider-mark">
      {providerInitials(name)}
    </span>
  )
}

export function SecretStorageWarningBanner(): React.JSX.Element {
  return (
    <div className="settings-warning-banner secret-storage-warning" role="status" data-testid="secret-storage-warning">
      <AlertTriangle size={14} aria-hidden="true" className="settings-warning-banner-icon" />
      <div>
        <strong className="settings-warning-banner-title">{'API keys are stored unencrypted'}</strong>
        <div className="settings-warning-banner-body">{'No OS keychain was found, so keys are saved in plain text in ~/.pawn/config.toml (readable only by you). To encrypt them, install and unlock GNOME Keyring or KWallet, then restart Pawn.'}</div>
      </div>
    </div>
  )
}

/** True when the main process reports provider secrets would be stored unencrypted. */
export function usePlaintextSecretStorage(): boolean {
  const [plaintext, setPlaintext] = useState(false)
  useEffect(() => {
    let alive = true
    const fn = window.api?.config?.secretStorageStatus
    if (!fn) return
    fn()
      .then((s) => { if (alive) setPlaintext(!s.encrypted) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return plaintext
}
