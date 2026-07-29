import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import type { ApiFormat, AuthMethod } from '../types/provider'
import './Settings.css'

type SettingsSection = 'appearance' | 'providers' | 'models' | 'agent' | 'plugins' | 'data'

interface SettingsProps {
  onClose: () => void
}

const SECTIONS: { id: SettingsSection; label: string; group: string; icon: string }[] = [
  { id: 'appearance', label: '외관', group: '일반', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'providers', label: '프로바이더', group: '일반', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
  { id: 'models', label: '모델', group: '일반', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'agent', label: '에이전트', group: '코딩', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'plugins', label: '플러그인 / 스킬', group: '통합', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
  { id: 'data', label: '데이터', group: '일반', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' },
]

export default function Settings({ onClose }: SettingsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { theme, set } = useThemeStore()
  const {
    providers, models, routingMode, defaultSendMode,
    addProvider, removeProvider, updateProvider,
    addModel, removeModel, setRoutingMode, setDefaultSendMode
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
  const groups = [...new Set(SECTIONS.map((s) => s.group))]

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        <button className="settings-back" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          <span>앱으로 돌아가기</span>
        </button>
        <div className="settings-nav">
          {groups.map((group) => (
            <div key={group} className="settings-nav-group">
              <div className="settings-nav-label">{group}</div>
              {SECTIONS.filter((s) => s.group === group).map((section) => (
                <button key={section.id} className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`} onClick={() => setActiveSection(section.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={section.icon} /></svg>
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-content">
        {activeSection === 'appearance' && (
          <div className="settings-section">
            <h2>외관</h2>
            <p className="settings-desc">테마와 언어를 설정합니다</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">테마</span><span className="settings-row-desc">라이트 또는 다크 모드</span></div>
                <div className="theme-toggle"><button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>Light</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>Dark</button></div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">언어</span><span className="settings-row-desc">인터페이스 표시 언어</span></div>
                <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'providers' && (
          <div className="settings-section">
            <h2>프로바이더</h2>
            <p className="settings-desc">API 엔드포인트와 인증 정보를 관리합니다</p>
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
              {providers.length === 0 && <div className="settings-empty">프로바이더가 없습니다</div>}
            </div>
            {showAddProvider ? (
              <div className="settings-card add-form">
                <input placeholder="이름 (예: OpenAI)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}><option value="openai">OpenAI API</option><option value="claude">Claude API</option></select>
                <select value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value as AuthMethod })}><option value="api-key">API Key</option><option value="oauth">OAuth</option></select>
                <input placeholder="Base URL" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
                {form.authMethod === 'api-key' && <input type="password" placeholder="API Key" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />}
                <div className="form-actions"><button className="btn-primary" onClick={handleAddProvider}>추가</button><button className="btn-cancel" onClick={() => setShowAddProvider(false)}>취소</button></div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddProvider(true)}>+ 프로바이더 추가</button>
            )}
          </div>
        )}

        {activeSection === 'models' && (
          <div className="settings-section">
            <h2>모델</h2>
            <p className="settings-desc">프로바이더별 사용 가능한 모델을 등록합니다</p>
            <div className="settings-card">
              {models.map((m) => (
                <div key={m.id} className="settings-row">
                  <div className="settings-row-info"><span className="settings-row-label">{m.label || m.modelId}</span><span className="settings-row-desc">{providers.find((p) => p.id === m.providerId)?.name} / {m.tier}</span></div>
                  <button className="delete-btn" onClick={() => removeModel(m.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                </div>
              ))}
              {models.length === 0 && <div className="settings-empty">모델이 없습니다</div>}
            </div>
            {showAddModel ? (
              <div className="settings-card add-form">
                <select value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}><option value="">프로바이더 선택...</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input placeholder="Model ID (예: gpt-4o)" value={modelForm.modelId} onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })} />
                <input placeholder="표시 이름 (선택)" value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
                <select value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}><option value="low">Low (빠름/저렴)</option><option value="mid">Mid (균형)</option><option value="high">High (강력)</option></select>
                <div className="form-actions"><button className="btn-primary" onClick={handleAddModel}>추가</button><button className="btn-cancel" onClick={() => setShowAddModel(false)}>취소</button></div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddModel(true)}>+ 모델 추가</button>
            )}
          </div>
        )}

        {activeSection === 'agent' && (
          <div className="settings-section">
            <h2>에이전트</h2>
            <p className="settings-desc">에이전트 동작 방식을 설정합니다</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">모델 라우팅</span><span className="settings-row-desc">작업 복잡도에 따른 자동 모델 선택</span></div>
                <div className="theme-toggle"><button className={routingMode === 'auto' ? 'active' : ''} onClick={() => setRoutingMode('auto')}>Auto</button><button className={routingMode === 'manual' ? 'active' : ''} onClick={() => setRoutingMode('manual')}>Manual</button></div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">기본 전송 모드</span><span className="settings-row-desc">스트리밍 중 새 메시지 처리 방식</span></div>
                <select value={defaultSendMode} onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}><option value="queue">Queue (대기열)</option><option value="steer">Steer (전환)</option></select>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'plugins' && (
          <div className="settings-section">
            <h2>플러그인 / 스킬</h2>
            <p className="settings-desc">Claude Code 스킬, MCP 서버, 플러그인을 관리합니다</p>
            <div className="settings-card">
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">Claude Code 스킬</span><span className="settings-row-desc">.claude/skills/ 디렉터리에서 자동 로드</span></div><span className="settings-badge">자동</span></div>
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">CLAUDE.md</span><span className="settings-row-desc">프로젝트 루트의 컨텍스트 파일</span></div><span className="settings-badge">자동</span></div>
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">.agent/ 디렉터리</span><span className="settings-row-desc">Codex 호환 스킬 파일</span></div><span className="settings-badge">자동</span></div>
            </div>
          </div>
        )}

        {activeSection === 'data' && (
          <div className="settings-section">
            <h2>데이터</h2>
            <p className="settings-desc">설정을 내보내거나 가져옵니다</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">설정 내보내기</span><span className="settings-row-desc">프로바이더, 모델, 설정을 JSON 파일로 저장</span></div>
                <button className="btn-action" onClick={() => { const data = { providers, models, settings: { routingMode, defaultSendMode } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'pawn-settings.json'; a.click(); URL.revokeObjectURL(url) }}>내보내기</button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">설정 가져오기</span><span className="settings-row-desc">JSON 파일에서 설정 복원</span></div>
                <button className="btn-action" onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const text = await file.text(); try { const data = JSON.parse(text); const store = useProviderStore.getState(); if (data.providers) data.providers.forEach((p: typeof providers[0]) => store.addProvider(p)); if (data.models) data.models.forEach((m: typeof models[0]) => store.addModel(m)) } catch {} }; input.click() }}>가져오기</button>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">설정 파일</span><span className="settings-row-desc">~/.pawn/config.toml</span></div></div>
              <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">데이터베이스</span><span className="settings-row-desc">~/.pawn/pawn.db (SQLite)</span></div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
