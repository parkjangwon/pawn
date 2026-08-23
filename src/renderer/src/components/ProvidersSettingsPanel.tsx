import { PROVIDER_PRESETS } from '../agent/providerPresets'
import { isOpenRouterProvider } from '../agent/listModels'
import type { ApiFormat } from '../types/provider'
import type { SettingsState } from './settingsState'

export default function ProvidersSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    providers,
    syncResult,
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
    handleAddFromPreset,
    showAddProvider,
    form,
    setForm,
    handleAddProvider,
    setShowAddProvider
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.providerSection.title')}</h2>
      <p className="settings-desc">{t('settings.providerSection.desc')}</p>
      <div className="settings-card">
        {providers.map((p) => {
          const isOpenRouter = isOpenRouterProvider(p)
          return (
            <div key={p.id} className="settings-row provider-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{p.name}</span>
                <span className="settings-row-desc">
                  {p.apiFormat} / {p.baseUrl}
                </span>
                {syncResult[p.id] && (
                  <span className="settings-row-desc sync-result" title={syncResult[p.id]}>
                    {syncResult[p.id]}
                  </span>
                )}
              </div>
              <div className="settings-row-actions">
                {!isOpenRouter ? (
                  <button
                    className="test-btn"
                    onClick={() => handleSyncModels(p.id)}
                    disabled={syncingId === p.id}
                    title={t('settings.providerSection.syncHint')}
                  >
                    {syncingId === p.id ? '...' : t('settings.providerSection.syncModels')}
                  </button>
                ) : (
                  <button
                    className="test-btn"
                    disabled
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    title={t('settings.providerSection.openRouterManualOnly')}
                  >
                    {t('settings.providerSection.manualOnly')}
                  </button>
                )}
                <button
                  className={`test-btn ${testResult[p.id] === 'OK' ? 'ok' : testResult[p.id]?.startsWith('FAIL') || testResult[p.id]?.startsWith('ERROR') ? 'fail' : ''}`}
                  onClick={() => handleTestProvider(p.id)}
                  disabled={testingId === p.id}
                  title={testResult[p.id] || undefined}
                >
                  {testingId === p.id ? '...' : testResult[p.id] || 'Test'}
                </button>
              <label className="toggle-switch">
                <input type="checkbox" checked={p.enabled} onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
              <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'provider', id: p.id, name: p.name })}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}
        {providers.length === 0 && <div className="settings-empty">{t('settings.providerSection.empty')}</div>}
      </div>

      <div className="preset-section">
        <div className="settings-row-desc preset-section-label">{t('settings.providerSection.presetDesc')}</div>
        <div className="preset-grid">
          {PROVIDER_PRESETS.map((preset) => {
            const isAlreadyAdded = providers.some(
              (p) => p.name.toLowerCase() === preset.name.toLowerCase()
            )
            return (
              <button
                key={preset.id}
                className={`preset-chip ${isAlreadyAdded ? 'disabled' : ''}`}
                onClick={() => { setPresetPicking(preset); setPresetKey('') }}
                disabled={isAlreadyAdded}
                style={isAlreadyAdded ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
              >
                {preset.name}
              </button>
            )
          })}
        </div>
        {presetPicking && (
          <div className="settings-card add-form preset-form">
            <div className="settings-row-label">{presetPicking.name}</div>
            <div className="settings-row-desc">{presetPicking.baseUrl}</div>
            <div className="settings-row-desc">
              {presetPicking.keyHintKey ? t(presetPicking.keyHintKey) : presetPicking.keyHint}
            </div>
            {!presetPicking.localNoKey && (
              <input
                type="password"
                placeholder={t('settings.providerSection.pasteApiKey')}
                value={presetKey}
                onChange={(e) => setPresetKey(e.target.value)}
                autoFocus
              />
            )}
            <div className="form-actions">
              <button
                className="btn-primary"
                onClick={() => handleAddFromPreset(presetPicking, presetKey)}
                disabled={!presetPicking.localNoKey && !presetKey.trim()}
              >
                {t('settings.providerSection.addWithModels', { count: presetPicking.models.length })}
              </button>
              <button className="btn-cancel" onClick={() => setPresetPicking(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {showAddProvider ? (
        <div className="settings-card add-form" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input placeholder={t('settings.providerSection.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}>
            <option value="openai">{t('settings.providerSection.openai')}</option>
            <option value="claude">{t('settings.providerSection.claude')}</option>
          </select>
          <input placeholder={t('settings.providerSection.baseUrlPlaceholder')} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <input type="password" placeholder={t('settings.providerSection.apiKeyPlaceholder')} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          <div className="form-actions">
            <button className="btn-primary" onClick={handleAddProvider}>{t('common.save')}</button>
            <button className="btn-cancel" onClick={() => setShowAddProvider(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddProvider(true)}>{t('settings.providerSection.add')}</button>
      )}
    </div>
  )
}
