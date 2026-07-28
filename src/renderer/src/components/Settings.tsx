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
    addProvider,
    removeProvider,
    updateProvider,
    addModel,
    removeModel,
    setRoutingMode
  } = useProviderStore()

  const [showAddProvider, setShowAddProvider] = useState(false)
  const [form, setForm] = useState({
    name: '',
    apiFormat: 'openai' as ApiFormat,
    authMethod: 'api-key' as AuthMethod,
    baseUrl: '',
    apiKey: ''
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
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* Theme */}
          <section className="settings-section">
            <h3>{t('settings.theme')}</h3>
            <div className="theme-toggle">
              <button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>
                ☀️ {t('theme.light')}
              </button>
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>
                🌙 {t('theme.dark')}
              </button>
            </div>
          </section>

          {/* Language */}
          <section className="settings-section">
            <h3>{t('settings.language')}</h3>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
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
                      {p.apiFormat} · {p.authMethod} · {p.baseUrl}
                    </span>
                  </div>
                  <div className="provider-actions">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                      />
                    </label>
                    <button className="remove-btn" onClick={() => removeProvider(p.id)}>🗑</button>
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
                + {t('settings.providers')}
              </button>
            )}
          </section>

          {/* Routing */}
          <section className="settings-section">
            <h3>{t('settings.models')}</h3>
            <div className="routing-toggle">
              <label>
                <input
                  type="radio"
                  checked={routingMode === 'auto'}
                  onChange={() => setRoutingMode('auto')}
                />
                Auto
              </label>
              <label>
                <input
                  type="radio"
                  checked={routingMode === 'manual'}
                  onChange={() => setRoutingMode('manual')}
                />
                Manual
              </label>
            </div>
            <div className="model-list">
              {models.map((m) => (
                <div key={m.id} className="model-item">
                  <span>{m.label} <em>({m.tier})</em></span>
                  <button className="remove-btn" onClick={() => removeModel(m.id)}>🗑</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
