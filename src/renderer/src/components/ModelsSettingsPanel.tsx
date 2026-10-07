import { Trash2 } from 'lucide-react'
import type { SettingsState } from './settingsState'
import { openSettingsSection } from './settingsState'
import Button from './Button'
import Input from './Input'
import Select from './Select'
import Switch from './Switch'

export default function ModelsSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
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
      <h2>{'Models'}</h2>
      <p className="settings-desc">{'Manage available models. Prefer Sync models on a provider so the list comes from their API instead of stale seeds. Mark vision capability so text-only models can fall back automatically.'}</p>
      <div className="settings-card">
        {models.map((m) => {
          const visionState = m.supportsVision === true ? 'yes' : m.supportsVision === false ? 'no' : 'auto'
          return (
            <div key={m.id} className="settings-row model-row">
              <div className="settings-row-info">
                <span className="settings-row-label">
                  {m.label || m.modelId}
                  {m.supportsVision === true && (
                    <span className="settings-badge vision-badge vision-yes" title={'Vision'}>
                      {'Vision'}
                    </span>
                  )}
                  {m.supportsVision === false && (
                    <span className="settings-badge vision-badge vision-no" title={'Text only'}>
                      {'Text'}
                    </span>
                  )}
                </span>
                <span className="settings-row-desc">
                  {providers.find((p) => p.id === m.providerId)?.name} / {m.tier}
                  {m.pricing
                    ? ` · $${m.pricing.input}/$${m.pricing.output} per 1M (in/out)`
                    : ' · pricing unknown — cost tracking disabled'}
                </span>
              </div>
              <div className="settings-row-actions">
                <Switch
                  checked={m.enabled !== false}
                  onCheckedChange={(v) => updateModel(m.id, { enabled: v })}
                  aria-label={`Use ${m.label || m.modelId}`}
                  title={`Use ${m.label || m.modelId}`}
                />
                <Select
                  className="vision-select"
                  value={visionState}
                  aria-label={'Vision (images)'}
                  title={'Yes = can see attached images/screenshots. No = text only (router will fall back). Auto = guess from the model id.'}
                  onChange={(e) => {
                    const v = e.target.value
                    updateModel(m.id, {
                      supportsVision: v === 'yes' ? true : v === 'no' ? false : undefined
                    })
                  }}
                >
                  <option value="auto">{'Auto'}</option>
                  <option value="yes">{'Vision'}</option>
                  <option value="no">{'Text only'}</option>
                </Select>
                <button
                  className="delete-btn"
                  aria-label={'Delete' + ': ' + (m.label || m.modelId)}
                  onClick={() => setConfirmDelete({ type: 'model', id: m.id, name: m.label || m.modelId })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
        {models.length === 0 && (
          <div className="settings-empty">
            {'No models configured'}
            <div>
              <button type="button" className="test-btn" onClick={() => openSettingsSection('providers')}>
                {'Add a provider in Settings → Providers, then sync models.'}
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
          <Select aria-label={'Select provider'} value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}>
            <option value="">{'Select provider'}</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input placeholder={'gpt-4o'} value={modelForm.modelId} onChange={(e) => applyModelIdGuess(e.target.value)} />
          <Input placeholder={'GPT-4o'} value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
          <Select aria-label={'Mid'} value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}>
            <option value="low">{'Low'}</option>
            <option value="mid">{'Mid'}</option>
            <option value="high">{'High'}</option>
          </Select>
          <label className="settings-field-label">{'Vision (images)'}</label>
          <Select value={modelForm.vision} onChange={(e) => setModelForm({ ...modelForm, vision: e.target.value as '' | 'yes' | 'no' })}>
            <option value="">{'Auto'}</option>
            <option value="yes">{'Vision'}</option>
            <option value="no">{'Text only'}</option>
          </Select>
          <div className="settings-row-desc">{'Yes = can see attached images/screenshots. No = text only (router will fall back). Auto = guess from the model id.'}</div>
          <div className="settings-row-desc" style={{ marginTop: 4 }}>{'Pricing (USD / 1M tokens) — used for router cost math and cache savings. Leave blank if unknown.'}</div>
          <div className="pricing-grid">
            <Input placeholder={'Input price'} type="number" step="0.01" aria-label={'Input price'} value={modelForm.input} onChange={(e) => setModelForm({ ...modelForm, input: e.target.value })} />
            <Input placeholder={'Output price'} type="number" step="0.01" aria-label={'Output price'} value={modelForm.output} onChange={(e) => setModelForm({ ...modelForm, output: e.target.value })} />
            <Input placeholder={'Cache read'} type="number" step="0.01" aria-label={'Cache read'} value={modelForm.cacheRead} onChange={(e) => setModelForm({ ...modelForm, cacheRead: e.target.value })} />
            <Input placeholder={'Cache write'} type="number" step="0.01" aria-label={'Cache write'} value={modelForm.cacheWrite} onChange={(e) => setModelForm({ ...modelForm, cacheWrite: e.target.value })} />
          </div>
          <Input placeholder={'Context window (tokens, optional)'} type="number" aria-label={'Context window (tokens, optional)'} value={modelForm.contextWindow} onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })} />
          {showAddModel && !modelForm.providerId && (
            <div className="settings-row-desc">{'Choose a provider to enable saving.'}</div>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={!modelForm.providerId || !modelForm.modelId.trim()}>
              {'Save'}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setShowAddModel(false)}>{'Cancel'}</Button>
          </div>
        </form>
      ) : (
        <button className="add-btn-full" onClick={() => setShowAddModel(true)}>{'Add model'}</button>
      )}
    </div>
  )
}
