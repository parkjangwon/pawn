import type { SettingsState } from './settingsState'
import { openSettingsSection } from './settingsState'

export default function ModelsSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    models,
    providers,
    updateModel,
    setConfirmDelete,
    showAddModel,
    setShowAddModel,
    modelForm,
    setModelForm,
    applyModelIdGuess,
    handleAddModel
  } = state

  return (
    <div className="settings-section">
      <h2>{t('settings.modelSection.title')}</h2>
      <p className="settings-desc">{t('settings.modelSection.desc')}</p>
      <div className="settings-card">
        {models.map((m) => {
          const visionState = m.supportsVision === true ? 'yes' : m.supportsVision === false ? 'no' : 'auto'
          return (
            <div key={m.id} className="settings-row model-row">
              <div className="settings-row-info">
                <span className="settings-row-label">
                  {m.label || m.modelId}
                  {m.supportsVision === true && (
                    <span className="settings-badge vision-badge vision-yes" title={t('settings.modelSection.visionYes')}>
                      {t('settings.modelSection.visionBadge')}
                    </span>
                  )}
                  {m.supportsVision === false && (
                    <span className="settings-badge vision-badge vision-no" title={t('settings.modelSection.visionNo')}>
                      {t('settings.modelSection.visionTextOnly')}
                    </span>
                  )}
                </span>
                <span className="settings-row-desc">
                  {providers.find((p) => p.id === m.providerId)?.name} / {m.tier}
                  {m.pricing
                    ? t('settings.modelSection.pricingFormat', { input: m.pricing.input, output: m.pricing.output })
                    : t('settings.modelSection.pricingUnknown')}
                </span>
              </div>
              <div className="settings-row-actions">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={m.enabled !== false}
                    aria-label={t('settings.modelSection.enableToggle', { name: m.label || m.modelId })}
                    title={t('settings.modelSection.enableToggle', { name: m.label || m.modelId })}
                    onChange={(e) => updateModel(m.id, { enabled: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
                <select
                  className="vision-select"
                  value={visionState}
                  aria-label={t('settings.modelSection.visionLabel')}
                  title={t('settings.modelSection.visionHint')}
                  onChange={(e) => {
                    const v = e.target.value
                    updateModel(m.id, {
                      supportsVision: v === 'yes' ? true : v === 'no' ? false : undefined
                    })
                  }}
                >
                  <option value="auto">{t('settings.modelSection.visionAuto')}</option>
                  <option value="yes">{t('settings.modelSection.visionYes')}</option>
                  <option value="no">{t('settings.modelSection.visionNo')}</option>
                </select>
                <button
                  className="delete-btn"
                  aria-label={t('common.delete') + ': ' + (m.label || m.modelId)}
                  onClick={() => setConfirmDelete({ type: 'model', id: m.id, name: m.label || m.modelId })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
        {models.length === 0 && (
          <div className="settings-empty">
            {t('settings.modelSection.empty')}
            <div>
              <button type="button" className="test-btn" onClick={() => openSettingsSection('providers')}>
                {t('models.emptyAddProvider')}
              </button>
            </div>
          </div>
        )}
      </div>
      {showAddModel ? (
        <form
          className="settings-card add-form"
          onSubmit={(e) => {
            e.preventDefault()
            void handleAddModel()
          }}
        >
          <select aria-label={t('settings.modelSection.selectProvider')} value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}>
            <option value="">{t('settings.modelSection.selectProvider')}</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder={t('settings.modelSection.modelIdPlaceholder')} value={modelForm.modelId} onChange={(e) => applyModelIdGuess(e.target.value)} />
          <input placeholder={t('settings.modelSection.displayNamePlaceholder')} value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
          <select aria-label={t('settings.modelSection.tierMid')} value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}>
            <option value="low">{t('settings.modelSection.tierLow')}</option>
            <option value="mid">{t('settings.modelSection.tierMid')}</option>
            <option value="high">{t('settings.modelSection.tierHigh')}</option>
          </select>
          <label className="settings-field-label">{t('settings.modelSection.visionLabel')}</label>
          <select value={modelForm.vision} onChange={(e) => setModelForm({ ...modelForm, vision: e.target.value as '' | 'yes' | 'no' })}>
            <option value="">{t('settings.modelSection.visionAuto')}</option>
            <option value="yes">{t('settings.modelSection.visionYes')}</option>
            <option value="no">{t('settings.modelSection.visionNo')}</option>
          </select>
          <div className="settings-row-desc">{t('settings.modelSection.visionHint')}</div>
          <div className="settings-row-desc" style={{ marginTop: 4 }}>{t('settings.modelSection.pricingDesc')}</div>
          <div className="pricing-grid">
            <input placeholder={t('settings.modelSection.priceInput')} type="number" step="0.01" aria-label={t('settings.modelSection.priceInput')} value={modelForm.input} onChange={(e) => setModelForm({ ...modelForm, input: e.target.value })} />
            <input placeholder={t('settings.modelSection.priceOutput')} type="number" step="0.01" aria-label={t('settings.modelSection.priceOutput')} value={modelForm.output} onChange={(e) => setModelForm({ ...modelForm, output: e.target.value })} />
            <input placeholder={t('settings.modelSection.priceCacheRead')} type="number" step="0.01" aria-label={t('settings.modelSection.priceCacheRead')} value={modelForm.cacheRead} onChange={(e) => setModelForm({ ...modelForm, cacheRead: e.target.value })} />
            <input placeholder={t('settings.modelSection.priceCacheWrite')} type="number" step="0.01" aria-label={t('settings.modelSection.priceCacheWrite')} value={modelForm.cacheWrite} onChange={(e) => setModelForm({ ...modelForm, cacheWrite: e.target.value })} />
          </div>
          <input placeholder={t('settings.modelSection.contextWindow')} type="number" aria-label={t('settings.modelSection.contextWindow')} value={modelForm.contextWindow} onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })} />
          {showAddModel && !modelForm.providerId && (
            <div className="settings-row-desc">{t('settings.modelSection.selectProviderHint')}</div>
          )}
          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={!modelForm.providerId || !modelForm.modelId.trim()}>
              {t('common.save')}
            </button>
            <button className="btn-cancel" type="button" onClick={() => setShowAddModel(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddModel(true)}>{t('settings.modelSection.add')}</button>
      )}
    </div>
  )
}
