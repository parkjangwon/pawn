import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { usePermissionStore } from '../stores/permission'
import type { ApiFormat, AuthMethod } from '../types/provider'
import './Settings.css'

type SettingsSection = 'appearance' | 'providers' | 'models' | 'agent' | 'plugins' | 'data'

interface SettingsProps {
  onClose: () => void
}

const SECTIONS: { id: SettingsSection; labelKey: string; groupKey: string; icon: string }[] = [
  { id: 'appearance', labelKey: 'settings.appearance', groupKey: 'settings.groups.general', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'providers', labelKey: 'settings.providers', groupKey: 'settings.groups.general', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
  { id: 'models', labelKey: 'settings.models', groupKey: 'settings.groups.general', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'agent', labelKey: 'settings.agent', groupKey: 'settings.groups.coding', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'plugins', labelKey: 'settings.plugins', groupKey: 'settings.groups.integration', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
  { id: 'data', labelKey: 'settings.data', groupKey: 'settings.groups.general', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' },
]

export default function Settings({ onClose }: SettingsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { theme, set } = useThemeStore()
  const {
    providers, models, routingMode, defaultSendMode, permissionMode,
    addProvider, removeProvider, updateProvider,
    addModel, removeModel, setRoutingMode, setDefaultSendMode, setPermissionMode
  } = useProviderStore()

  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [showAddModel, setShowAddModel] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ name: '', apiFormat: 'openai' as ApiFormat, authMethod: 'api-key' as AuthMethod, baseUrl: '', apiKey: '' })
  const [modelForm, setModelForm] = useState({ providerId: '', modelId: '', label: '', tier: 'mid' as 'low' | 'mid' | 'high' })

  const handleAddProvider = (): void => {
    if (!form.name.trim() || !form.baseUrl.trim()) return
    addProvider({ id: '', name: form.name.trim(), apiFormat: form.apiFormat, authMethod: form.authMethod, baseUrl: form.baseUrl.trim(), apiKey: form.authMethod === 'api-key' ? form.apiKey : undefined, enabled: true })
    setForm({ name: '', apiFormat: 'openai', authMethod: 'api-key', baseUrl: '', apiKey: '' })
    setShowAddProvider(false)
  }

  const handleAddModel = (): void => {
    if (!modelForm.providerId || !modelForm.modelId.trim()) return
    addModel({ id: '', providerId: modelForm.providerId, modelId: modelForm.modelId.trim(), label: modelForm.label.trim() || modelForm.modelId.trim(), tier: modelForm.tier, enabled: true })
    setModelForm({ providerId: '', modelId: '', label: '', tier: 'mid' })
    setShowAddModel(false)
  }

  const handleTestProvider = async (providerId: string): Promise<void> => {
    const p = providers.find((pr) => pr.id === providerId)
    if (!p) return
    setTestingId(providerId)
    setTestResult((r) => ({ ...r, [providerId]: '' }))
    try {
      const url = p.apiFormat === 'claude' ? `${p.baseUrl}/messages` : `${p.baseUrl}/chat/completions`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (p.apiFormat === 'claude') { headers['x-api-key'] = p.apiKey || ''; headers['anthropic-version'] = '2023-06-01' }
      else { headers['Authorization'] = `Bearer ${p.apiKey || ''}` }
      const body = p.apiFormat === 'claude' ? { model: 'claude-3-haiku-20240307', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] } : { model: 'gpt-4o-mini', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }
      const isBrowser = window.api?.platform === 'browser'
      let response: Response
      if (isBrowser) { response = await fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, headers, body: JSON.stringify(body) }) }) }
      else { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }) }
      if (response.ok) setTestResult((r) => ({ ...r, [providerId]: 'OK' }))
      else { setTestResult((r) => ({ ...r, [providerId]: `FAIL: ${response.status}` })) }
    } catch { setTestResult((r) => ({ ...r, [providerId]: 'ERROR' })) }
    finally { setTestingId(null) }
  }

  const languages = [{ code: 'en', label: 'English' }, { code: 'ko', label: '한국어' }, { code: 'ja', label: '日本語' }, { code: 'zh', label: '中文' }]
  const groups = [...new Set(SECTIONS.map((s) => s.groupKey))]

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        <button className="settings-back" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          <span>{t('settings.backToApp')}</span>
        </button>
        <div className="settings-nav">
          {groups.map((group) => (
            <div key={group} className="settings-nav-group">
              <div className="settings-nav-label">{t(group)}</div>
              {SECTIONS.filter((s) => s.groupKey === group).map((section) => (
                <button key={section.id} className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`} onClick={() => setActiveSection(section.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={section.icon} /></svg>
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-content">
        {activeSection === 'appearance' && (
          <div className="settings-section">
            <h2>{t('settings.appearanceSection.title')}</h2>
            <p className="settings-desc">{t('settings.appearanceSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.appearanceSection.theme')}</span><span className="settings-row-desc">{t('settings.appearanceSection.themeDesc')}</span></div>
                <div className="theme-toggle"><button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>{t('theme.light')}</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>{t('theme.dark')}</button></div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.appearanceSection.language')}</span><span className="settings-row-desc">{t('settings.appearanceSection.languageDesc')}</span></div>
                <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'providers' && (
          <div className="settings-section">
            <h2>{t('settings.providerSection.title')}</h2>
            <p className="settings-desc">{t('settings.providerSection.desc')}</p>
            <div className="settings-card">
              {providers.map((p) => (
                <div key={p.id} className="settings-row provider-row">
                  <div className="settings-row-info"><span className="settings-row-label">{p.name}</span><span className="settings-row-desc">{p.apiFormat} / {p.baseUrl}</span></div>
                  <div className="settings-row-actions">
                    <button className={`test-btn ${testResult[p.id] === 'OK' ? 'ok' : testResult[p.id] ? 'fail' : ''}`} onClick={() => handleTestProvider(p.id)} disabled={testingId === p.id}>{testingId === p.id ? '...' : testResult[p.id] || 'Test'}</button>
                    <label className="toggle-switch"><input type="checkbox" checked={p.enabled} onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })} /><span className="toggle-slider" /></label>
                    <button className="delete-btn" onClick={() => removeProvider(p.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                  </div>
                </div>
              ))}
              {providers.length === 0 && <div className="settings-empty">{t('settings.providerSection.empty')}</div>}
            </div>
            {showAddProvider ? (
              <div className="settings-card add-form">
                <input placeholder={t('settings.providerSection.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}><option value="openai">{t('settings.providerSection.openai')}</option><option value="claude">{t('settings.providerSection.claude')}</option></select>
                <select value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value as AuthMethod })}><option value="api-key">{t('settings.providerSection.apiKeyMethod')}</option><option value="oauth">{t('settings.providerSection.oauth')}</option></select>
                <input placeholder={t('settings.providerSection.baseUrlPlaceholder')} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
                {form.authMethod === 'api-key' && <input type="password" placeholder={t('settings.providerSection.apiKeyPlaceholder')} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />}
                <div className="form-actions"><button className="btn-primary" onClick={handleAddProvider}>{t('common.save')}</button><button className="btn-cancel" onClick={() => setShowAddProvider(false)}>{t('common.cancel')}</button></div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddProvider(true)}>{t('settings.providerSection.add')}</button>
            )}
          </div>
        )}

        {activeSection === 'models' && (
          <div className="settings-section">
            <h2>{t('settings.modelSection.title')}</h2>
            <p className="settings-desc">{t('settings.modelSection.desc')}</p>
            <div className="settings-card">
              {models.map((m) => (
                <div key={m.id} className="settings-row">
                  <div className="settings-row-info"><span className="settings-row-label">{m.label || m.modelId}</span><span className="settings-row-desc">{providers.find((p) => p.id === m.providerId)?.name} / {m.tier}</span></div>
                  <button className="delete-btn" onClick={() => removeModel(m.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                </div>
              ))}
              {models.length === 0 && <div className="settings-empty">{t('settings.modelSection.empty')}</div>}
            </div>
            {showAddModel ? (
              <div className="settings-card add-form">
                <select value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}><option value="">{t('settings.modelSection.selectProvider')}</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input placeholder={t('settings.modelSection.modelIdPlaceholder')} value={modelForm.modelId} onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })} />
                <input placeholder={t('settings.modelSection.displayNamePlaceholder')} value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
                <select value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}><option value="low">{t('settings.modelSection.tierLow')}</option><option value="mid">{t('settings.modelSection.tierMid')}</option><option value="high">{t('settings.modelSection.tierHigh')}</option></select>
                <div className="form-actions"><button className="btn-primary" onClick={handleAddModel}>{t('common.save')}</button><button className="btn-cancel" onClick={() => setShowAddModel(false)}>{t('common.cancel')}</button></div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddModel(true)}>{t('settings.modelSection.add')}</button>
            )}
          </div>
        )}

        {activeSection === 'agent' && (
          <div className="settings-section">
            <h2>{t('settings.agentSection.title')}</h2>
            <p className="settings-desc">{t('settings.agentSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.agentSection.routing')}</span><span className="settings-row-desc">{t('settings.agentSection.routingDesc')}</span></div>
                <div className="theme-toggle"><button className={routingMode === 'auto' ? 'active' : ''} onClick={() => setRoutingMode('auto')}>{t('statusBar.auto')}</button><button className={routingMode === 'manual' ? 'active' : ''} onClick={() => setRoutingMode('manual')}>{t('statusBar.manual')}</button></div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.agentSection.sendMode')}</span><span className="settings-row-desc">{t('settings.agentSection.sendModeDesc')}</span></div>
                <select value={defaultSendMode} onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}><option value="queue">{t('settings.agentSection.queue')}</option><option value="steer">{t('settings.agentSection.steer')}</option></select>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.agentSection.permissionMode')}</span><span className="settings-row-desc">{t('settings.agentSection.permissionModeDesc')}</span></div>
                <div className="theme-toggle">
                  <button className={permissionMode === 'ask' ? 'active' : ''} onClick={() => setPermissionMode('ask')}>{t('permission.ask')}</button>
                  <button className={permissionMode === 'auto' ? 'active' : ''} onClick={() => setPermissionMode('auto')}>{t('permission.auto')}</button>
                  <button className={permissionMode === 'yolo' ? 'active' : ''} onClick={() => setPermissionMode('yolo')}>{t('permission.yolo')}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'plugins' && (
          <div className="settings-section">
            <h2>{t('settings.pluginSection.title')}</h2>
            <p className="settings-desc">{t('settings.pluginSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{t('settings.pluginSection.claudeSkills')}</span><span className="settings-row-desc">{t('settings.pluginSection.claudeSkillsDesc')}</span></div><span className="settings-badge">{t('settings.pluginSection.auto')}</span></div>
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{t('settings.pluginSection.claudeMd')}</span><span className="settings-row-desc">{t('settings.pluginSection.claudeMdDesc')}</span></div><span className="settings-badge">자동</span></div>
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{t('settings.pluginSection.agentDir')}</span><span className="settings-row-desc">{t('settings.pluginSection.agentDirDesc')}</span></div><span className="settings-badge">자동</span></div>
            </div>
          </div>
        )}

        {activeSection === 'data' && (
          <div className="settings-section">
            <h2>{t('settings.dataSection.title')}</h2>
            <p className="settings-desc">{t('settings.dataSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.dataSection.export')}</span><span className="settings-row-desc">{t('settings.dataSection.exportDesc')}</span></div>
                <button className="btn-action" onClick={() => { const data = { providers, models, settings: { routingMode, defaultSendMode } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'pawn-settings.json'; a.click(); URL.revokeObjectURL(url) }}>{t('settings.dataSection.export')}</button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.dataSection.import')}</span><span className="settings-row-desc">{t('settings.dataSection.importDesc')}</span></div>
                <button className="btn-action" onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const text = await file.text(); try { const data = JSON.parse(text); const store = useProviderStore.getState(); if (data.providers) data.providers.forEach((p: typeof providers[0]) => store.addProvider(p)); if (data.models) data.models.forEach((m: typeof models[0]) => store.addModel(m)) } catch {} }; input.click() }}>{t('settings.dataSection.import')}</button>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{t('settings.dataSection.configFile')}</span><span className="settings-row-desc">{t('settings.dataSection.configFileDesc')}</span></div></div>
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{t('settings.dataSection.database')}</span><span className="settings-row-desc">{t('settings.dataSection.databaseDesc')}</span></div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
