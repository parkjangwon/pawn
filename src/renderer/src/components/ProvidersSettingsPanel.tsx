import { Trash2 } from 'lucide-react'
import { PROVIDER_PRESETS } from '../agent/providerPresets'
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
    formError,
    setFormError,
    handleAddFromPreset,
    showAddProvider,
    form,
    setForm,
    handleAddProvider,
    setShowAddProvider
  } = state

  return (
    <div className="settings-section">
      <h2>{'Providers'}</h2>
      <p className="settings-desc">{'Manage AI provider connections'}</p>
      <div className="settings-card">
        {providers.map((p) => {
          const isOpenRouter = isOpenRouterProvider(p)
          const noCatalog = isChatGptCodexBase(p.baseUrl) || isAntigravityBase(p.baseUrl)
          return (
            <div key={p.id} className="settings-row provider-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{p.name}</span>
                <span className="settings-row-desc">
                  {p.apiFormat} / {p.baseUrl}
                </span>
                {syncResult[p.id] && (
                  <span
                    className={`settings-row-desc sync-result${syncFailed[p.id] ? ' provider-sync-warn' : ''}`}
                    title={syncResult[p.id]}
                  >
                    {syncResult[p.id]}
                  </span>
                )}
                {p.apiFormat === 'kiro' && <KiroAuthPanel onSignedIn={() => void handleSyncModels(p.id)} />}
                {isXaiHost(p.baseUrl) && <XaiAuthPanel onSignedIn={() => void handleSyncModels(p.id)} />}
                {isChatGptCodexBase(p.baseUrl) && <SubscriptionAuthPanel kind="chatgpt" />}
                {isClaudeApiBase(p.baseUrl) && <SubscriptionAuthPanel kind="claude" onSignedIn={() => void handleSyncModels(p.id)} />}
                {isAntigravityBase(p.baseUrl) && <SubscriptionAuthPanel kind="antigravity" />}
              </div>
              <div className="settings-row-actions">
                {noCatalog ? null : !isOpenRouter ? (
                  <button
                    className="test-btn"
                    onClick={() => handleSyncModels(p.id)}
                    disabled={syncingId === p.id}
                    title={'Fetch the live model catalog from GET {baseUrl}/models and merge it into your list'}
                  >
                    {syncingId === p.id ? 'Loading…' : 'Sync models'}
                  </button>
                ) : (
                  <button
                    className="test-btn disabled"
                    disabled
                    title={'OpenRouter offers hundreds of models; please register specific models manually to prevent clutter.'}
                  >
                    {'Manual add only'}
                  </button>
                )}
                <button
                  className={`test-btn ${testResult[p.id]?.ok ? 'ok' : testResult[p.id] ? 'fail' : ''}`}
                  onClick={() => handleTestProvider(p.id)}
                  disabled={testingId === p.id}
                >
                  {testingId === p.id ? 'Loading…' : 'Test connection'}
                </button>
              <Switch
                checked={p.enabled}
                onCheckedChange={(v) => updateProvider(p.id, { enabled: v })}
                aria-label={`Enable ${p.name}`}
              />
              <button
                className="delete-btn"
                aria-label={'Delete' + ': ' + p.name}
                onClick={() => setConfirmDelete({ type: 'provider', id: p.id, name: p.name })}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {testResult[p.id] && (
              <div className={'settings-form-error provider-test-line' + (testResult[p.id]?.ok ? ' test-ok' : '')} role="status">
                {testResult[p.id]?.ok ? '✓ ' + 'Connected' : '✗ ' + testResult[p.id]?.message}
              </div>
            )}
          </div>
        )
      })}
        {providers.length === 0 && <div className="settings-empty">{'No providers configured'}</div>}
      </div>

      <div className="preset-section">
        <div className="settings-row-desc preset-section-label">{'Well-known providers — paste an API key and go. Model lists refresh from each provider’s API when possible.'}</div>
        <div className="preset-grid">
          {PROVIDER_PRESETS.map((preset) => {
            const isAlreadyAdded = providers.some(
              (p) => p.name.toLowerCase() === preset.name.toLowerCase()
            )
            const isRecommended = ['anthropic', 'openai', 'deepseek'].includes(preset.id.toLowerCase())
            return (
              <button
                key={preset.id}
                className={`preset-chip ${isAlreadyAdded ? 'disabled' : ''} ${isRecommended ? 'recommended' : ''}`}
                onClick={() => { setPresetPicking(preset); setPresetKey(''); if (presetKeyError) setPresetKeyError('') }}
                disabled={isAlreadyAdded}
              >
                <span>{preset.name}</span>
                {isRecommended && !isAlreadyAdded && <span className="preset-recommended-tag">★</span>}
              </button>
            )
          })}
        </div>
        {presetPicking && (
          <div className="settings-card add-form preset-form">
            <div className="settings-row-label">{presetPicking.name}</div>
            <div className="settings-row-desc">{presetPicking.baseUrl}</div>
            <div className="settings-row-desc">
              {presetPicking.keyHintKey ? tx(presetPicking.keyHintKey) : presetPicking.keyHint}
            </div>
            {!presetPicking.localNoKey && !presetPicking.signIn && (
              <>
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
              </>
            )}
            <div className="form-actions">
              <Button
                onClick={() => handleAddFromPreset(presetPicking, presetKey)}
                disabled={!presetPicking.localNoKey && !presetPicking.signIn && !presetPicking.optionalKey && !presetKey.trim()}
              >
                {`Add (includes ${presetPicking.models.length} models)`}
              </Button>
              <Button variant="secondary" onClick={() => setPresetPicking(null)}>{'Cancel'}</Button>
            </div>
          </div>
        )}
      </div>

      {showAddProvider ? (
        <form
          className="settings-card add-form"
          onSubmit={(e) => {
            e.preventDefault()
            void handleAddProvider()
          }}
        >
          <Input placeholder={'My provider'} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (formError) setFormError('') }} />
          <Select aria-label={'My provider'} value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}>
            <option value="openai">{'OpenAI'}</option>
            <option value="claude">{'Claude'}</option>
            <option value="kiro">Kiro</option>
          </Select>
          <Input placeholder={'https://api.example.com'} value={form.baseUrl} onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); if (formError) setFormError('') }} />
          <Input type="password" placeholder={'sk-…'} value={form.apiKey} onChange={(e) => { setForm({ ...form, apiKey: e.target.value }); if (formError) setFormError('') }} />
          {formError && <div className="settings-form-error" role="alert">{formError}</div>}
          <div className="form-actions">
            <Button type="submit">{'Save'}</Button>
            <Button variant="secondary" type="button" onClick={() => setShowAddProvider(false)}>{'Cancel'}</Button>
          </div>
        </form>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddProvider(true)}>{'Add custom provider'}</button>
      )}
    </div>
  )
}
