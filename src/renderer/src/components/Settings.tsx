import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import type { ApiFormat, AuthMethod } from '../types/provider'
import './Settings.css'

export default function Settings({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { theme, set } = useThemeStore()
  const {
    providers,
    models,
    routingMode,
    defaultSendMode,
    addProvider,
    removeProvider,
    updateProvider,
    addModel,
    removeModel,
    setRoutingMode,
    setDefaultSendMode
  } = useProviderStore()

  const [showAddProvider, setShowAddProvider] = useState(false)
  const [showAddModel, setShowAddModel] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    name: '',
    apiFormat: 'openai' as ApiFormat,
    authMethod: 'api-key' as AuthMethod,
    baseUrl: '',
    apiKey: ''
  })
  const [modelForm, setModelForm] = useState({
    providerId: '',
    modelId: '',
    label: '',
    tier: 'mid' as 'low' | 'mid' | 'high'
  })

  const handleAddProvider = (): void => {
    if (!form.name.trim() || !form.baseUrl.trim()) return
    addProvider({
      id: '',
      name: form.name.trim(),
      apiFormat: form.apiFormat,
      authMethod: form.authMethod,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.authMethod === 'api-key' ? form.apiKey : undefined,
      enabled: true
    })
    setForm({ name: '', apiFormat: 'openai', authMethod: 'api-key', baseUrl: '', apiKey: '' })
    setShowAddProvider(false)
  }

  const handleAddModel = (): void => {
    if (!modelForm.providerId || !modelForm.modelId.trim()) return
    addModel({
      id: '',
      providerId: modelForm.providerId,
      modelId: modelForm.modelId.trim(),
      label: modelForm.label.trim() || modelForm.modelId.trim(),
      tier: modelForm.tier,
      enabled: true
    })
    setModelForm({ providerId: '', modelId: '', label: '', tier: 'mid' })
    setShowAddModel(false)
  }

  const handleTestProvider = async (providerId: string): Promise<void> => {
    const p = providers.find((pr) => pr.id === providerId)
    if (!p) return
    setTestingId(providerId)
    setTestResult((r) => ({ ...r, [providerId]: '' }))

    try {
      const url = p.apiFormat === 'claude'
        ? `${p.baseUrl}/messages`
        : `${p.baseUrl}/chat/completions`

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (p.apiFormat === 'claude') {
        headers['x-api-key'] = p.apiKey || ''
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${p.apiKey || ''}`
      }

      const body = p.apiFormat === 'claude'
        ? { model: 'claude-3-haiku-20240307', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }
        : { model: 'gpt-4o-mini', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }

      const isBrowser = window.api?.platform === 'browser'
      let response: Response

      if (isBrowser) {
        response = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, headers, body: JSON.stringify(body) })
        })
      } else {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      }

      if (response.ok) {
        setTestResult((r) => ({ ...r, [providerId]: 'OK' }))
      } else {
        const text = await response.text()
        setTestResult((r) => ({ ...r, [providerId]: `FAIL: ${response.status} ${text.slice(0, 100)}` }))
      }
    } catch (err) {
      setTestResult((r) => ({ ...r, [providerId]: `ERROR: ${err}` }))
    } finally {
      setTestingId(null)
    }
  }

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'ko', label: '한국어' },
    { code: 'ja', label: '日本語' },
    { code: 'zh', label: '中文' }
  ]

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          {/* Appearance */}
          <section className="settings-section">
            <h3>{t('settings.appearance')}</h3>
            <div className="setting-row">
              <span className="setting-label">{t('settings.theme')}</span>
              <div className="theme-toggle">
                <button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>
                  Light
                </button>
                <button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>
                  Dark
                </button>
              </div>
            </div>
            <div className="setting-row">
              <span className="setting-label">{t('settings.language')}</span>
              <select
                value={i18n.language}
                onChange={(e) => i18n.changeLanguage(e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>
          </section>

          {/* Chat */}
          <section className="settings-section">
            <h3>{t('settings.chat')}</h3>
            <div className="setting-row">
              <span className="setting-label">{t('settings.defaultSendMode')}</span>
              <select
                value={defaultSendMode}
                onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}
              >
                <option value="queue">Queue</option>
                <option value="steer">Steer</option>
              </select>
            </div>
            <div className="setting-row">
              <span className="setting-label">{t('settings.routing')}</span>
              <div className="theme-toggle">
                <button className={routingMode === 'auto' ? 'active' : ''} onClick={() => setRoutingMode('auto')}>
                  Auto
                </button>
                <button className={routingMode === 'manual' ? 'active' : ''} onClick={() => setRoutingMode('manual')}>
                  Manual
                </button>
              </div>
            </div>
          </section>

          {/* Providers */}
          <section className="settings-section">
            <h3>{t('settings.providers')}</h3>
            <div className="provider-list">
              {providers.map((p) => (
                <div key={p.id} className="provider-item">
                  <div className="provider-info">
                    <span className="provider-name">{p.name}</span>
                    <span className="provider-meta">
                      {p.apiFormat} / {p.authMethod} / {p.baseUrl}
                    </span>
                  </div>
                  <div className="provider-actions">
                    <button
                      className="test-btn"
                      onClick={() => handleTestProvider(p.id)}
                      disabled={testingId === p.id}
                      title="Test connection"
                    >
                      {testingId === p.id ? '...' : testResult[p.id] === 'OK' ? 'OK' : testResult[p.id] ? '!' : 'Test'}
                    </button>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                      />
                      <span className="toggle-slider" />
                    </label>
                    <button className="remove-btn" onClick={() => removeProvider(p.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {showAddProvider ? (
              <div className="add-provider-form">
                <input
                  placeholder="Name (e.g. OpenAI)"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <select
                  value={form.apiFormat}
                  onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}
                >
                  <option value="openai">OpenAI API</option>
                  <option value="claude">Claude API</option>
                </select>
                <select
                  value={form.authMethod}
                  onChange={(e) => setForm({ ...form, authMethod: e.target.value as AuthMethod })}
                >
                  <option value="api-key">API Key</option>
                  <option value="oauth">OAuth</option>
                </select>
                <input
                  placeholder="Base URL (e.g. https://api.openai.com/v1)"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
                {form.authMethod === 'api-key' && (
                  <input
                    type="password"
                    placeholder="API Key"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                )}
                <div className="form-actions">
                  <button className="primary-btn" onClick={handleAddProvider}>Add</button>
                  <button onClick={() => setShowAddProvider(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="add-btn" onClick={() => setShowAddProvider(true)}>
                + Add Provider
              </button>
            )}
          </section>

          {/* Models */}
          <section className="settings-section">
            <h3>{t('settings.models')}</h3>
            <div className="model-list">
              {models.map((m) => (
                <div key={m.id} className="model-item">
                  <span>{m.label} <em>({m.tier})</em></span>
                  <button className="remove-btn" onClick={() => removeModel(m.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
              {models.length === 0 && (
                <div className="empty-hint">No models configured</div>
              )}
            </div>

            {showAddModel ? (
              <div className="add-provider-form">
                <select
                  value={modelForm.providerId}
                  onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}
                >
                  <option value="">Select provider...</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  placeholder="Model ID (e.g. gpt-4o, claude-sonnet-4-20250514)"
                  value={modelForm.modelId}
                  onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })}
                />
                <input
                  placeholder="Display label (optional)"
                  value={modelForm.label}
                  onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })}
                />
                <select
                  value={modelForm.tier}
                  onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}
                >
                  <option value="low">Low (fast, cheap)</option>
                  <option value="mid">Mid (balanced)</option>
                  <option value="high">High (powerful)</option>
                </select>
                <div className="form-actions">
                  <button className="primary-btn" onClick={handleAddModel}>Add Model</button>
                  <button onClick={() => setShowAddModel(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="add-btn" onClick={() => setShowAddModel(true)}>
                + Add Model
              </button>
            )}
          </section>

          {/* Data */}
          <section className="settings-section">
            <h3>Data</h3>
            <div className="setting-row">
              <span className="setting-label">Export settings</span>
              <button className="add-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={() => {
                const data = {
                  providers: useProviderStore.getState().providers,
                  models: useProviderStore.getState().models,
                  routingMode: useProviderStore.getState().routingMode,
                  defaultSendMode: useProviderStore.getState().defaultSendMode
                }
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'hjcode-settings.json'
                a.click()
                URL.revokeObjectURL(url)
              }}>Export</button>
            </div>
            <div className="setting-row">
              <span className="setting-label">Import settings</span>
              <button className="add-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = '.json'
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (!file) return
                  const text = await file.text()
                  try {
                    const data = JSON.parse(text)
                    const store = useProviderStore.getState()
                    if (data.providers) data.providers.forEach((p: typeof providers[0]) => store.addProvider(p))
                    if (data.models) data.models.forEach((m: typeof models[0]) => store.addModel(m))
                    if (data.routingMode) store.setRoutingMode(data.routingMode)
                    if (data.defaultSendMode) store.setDefaultSendMode(data.defaultSendMode)
                  } catch { /* invalid file */ }
                }
                input.click()
              }}>Import</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
