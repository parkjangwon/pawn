import NavControls from './NavControls'
import ConfirmDialog from './ConfirmDialog'
import MemorySettingsPanel from './MemorySettingsPanel'
import HooksSettingsPanel from './HooksSettingsPanel'
import AgentsSettingsPanel from './AgentsSettingsPanel'
import PermissionsAlwaysPanel from './PermissionsAlwaysPanel'
import UsageSettingsPanel from './UsageSettingsPanel'
import logoGitlab from '../assets/logos/gitlab.svg'
import logoCodeCommit from '../assets/logos/codecommit.svg'
import { SECTIONS, type SettingsProps, type SettingsSection, type SettingsSkillScope } from './settingsMeta'
import { useSettingsState } from './settingsState'
import { useMcpStore } from '../stores/mcp'
import { useProviderStore } from '../stores/provider'
import { KEYBINDING_IDS, DEFAULT_KEYBINDINGS, formatCombo } from '../stores/keybindings'
import { PROVIDER_PRESETS } from '../agent/providerPresets'
import { MCP_TEMPLATES } from '../agent/mcpTemplates'
import { skillSummary } from '../agent/skills'
import { isSkillEnabled } from '../utils/skillVisibility'
import type { ApiFormat } from '../types/provider'
import './Settings.css'

export default function Settings({
  onSidebarWidthChange, canGoBack, canGoForward, onGoBack, onGoForward
}: SettingsProps): React.JSX.Element {
  const {
    t, i18n,
    theme, set,
    mcpServers, toggleMcpServer,
    sleepPrevention, setSleepPrevention, taskNotificationsEnabled, setTaskNotificationsEnabled,
    confirmQuit, setConfirmQuit, sessionBudgetUsd, setSessionBudgetUsd, dailyBudgetUsd, setDailyBudgetUsd,
    checkUpdatesOnLaunch, setCheckUpdatesOnLaunch,
    updateMsg, setUpdateMsg, updateChecking, setUpdateChecking, backupMsg, setBackupMsg, importMsg, setImportMsg,
    keybindings, setKeybinding, resetKeybinding,
    recording, setRecording, trayVisible, setTrayVisible, navOpen, setNavOpen,
    attachResizer,
    providers, models, routingMode, defaultSendMode, permissionMode, visionModelId,
    addProvider, removeProvider, updateProvider,
    addModel, removeModel, updateModel, syncModelsFromProvider,
    setRoutingMode, setDefaultSendMode, setPermissionMode,
    shellSandbox, setShellSandbox, shellNetwork, setShellNetwork,
    shellCwdJail, setShellCwdJail, autoMemoryConsolidate, setAutoMemoryConsolidate,
    setVisionModel,
    activeSection, setActiveSection, showAddProvider, setShowAddProvider, presetPicking, setPresetPicking,
    presetKey, setPresetKey, showAddModel, setShowAddModel, testingId, setTestingId, testResult, setTestResult,
    syncingId, setSyncingId, syncResult, setSyncResult, form, setForm, modelForm, setModelForm,
    homeDir, setHomeDir, loadedSkills, setLoadedSkills, skillsLoading, setSkillsLoading,
    skillScope, setSkillScope, skillSearch, setSkillSearch, disabledSkills, setDisabledSkills,
    contextSignals, setContextSignals, contextAdditionCount, setContextAdditionCount,
    mcpLoading, setMcpLoading, showAddMcpServer, setShowAddMcpServer, mcpForm, setMcpForm, mcpScope, setMcpScope,
    mcpFormError, setMcpFormError, mcpAdding, setMcpAdding, confirmDelete, setConfirmDelete,
    pawnPaths, setPawnPaths, connStatus, setConnStatus, connBusy, setConnBusy, connMsg, setConnMsg,
    deviceAuth, setDeviceAuth, patFormOpen, setPatFormOpen, patForm, setPatForm,
    activeProject, activeProjectId, projectPath,
    applyModelIdGuess, visionCandidates, handleAddFromPreset, handleSyncModels, handleAddProvider, handleAddModel,
    handleAddMcpServer, handleRemoveMcpServer, handleTestProvider, shortcutLabel, comboConflict,
    fileExists, countMarkdownFiles, countSubdirs, detectContextSignals, groups, visibleSkills, scopeCounts,
    enabledSkillCount, toggleSkill, handleConfirmDelete, refreshConnections, handleConnect, openPatForm,
    handleConnectPat, handleCancelConnect, handleDisconnect, connProviderLabel, copyDeviceCode, languages
  } = useSettingsState({ onSidebarWidthChange })

  return (
    <div className={`settings-page ${navOpen ? '' : 'nav-collapsed'}`}>
      <div className="settings-header">
        <div className="settings-header-left">
          <button className="settings-header-back" onClick={() => setNavOpen((v) => !v)} aria-label={t('settings.toggleNav')} title={t('settings.toggleNav')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
        </div>
      </div>
      <div className="settings-sidebar">
        <div className="settings-sidebar-top-row">
          <span className="sidebar-logo">Pawn</span>
        </div>
        <div className="settings-nav">
          {groups.map((group) => (
            <div key={group} className="settings-nav-group">
              <div className="settings-nav-label">{t(group)}</div>
              {SECTIONS.filter((s) => s.groupKey === group).map((section) => (
                <button key={section.id} className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`} onClick={() => setActiveSection(section.id)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={section.icon} /></svg>
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-resizer" ref={attachResizer} role="separator" aria-orientation="vertical" />

      <div className="settings-content">
        {activeSection === 'appearance' && (
          <div className="settings-section">
            <h2>{t('settings.appearanceSection.title')}</h2>
            <p className="settings-desc">{t('settings.appearanceSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.appearanceSection.theme')}</span><span className="settings-row-desc">{t('settings.appearanceSection.themeDesc')}</span></div>
                <div className="theme-toggle"><button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>{t('theme.light')}</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>{t('theme.dark')}</button><button className={theme === 'system' ? 'active' : ''} onClick={() => set('system')}>{t('theme.system')}</button></div>
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
                    <button
                      className="test-btn"
                      onClick={() => handleSyncModels(p.id)}
                      disabled={syncingId === p.id}
                      title={t('settings.providerSection.syncHint')}
                    >
                      {syncingId === p.id ? '...' : t('settings.providerSection.syncModels')}
                    </button>
                    <button
                      className={`test-btn ${testResult[p.id] === 'OK' ? 'ok' : testResult[p.id]?.startsWith('FAIL') || testResult[p.id]?.startsWith('ERROR') ? 'fail' : ''}`}
                      onClick={() => handleTestProvider(p.id)}
                      disabled={testingId === p.id}
                      title={testResult[p.id] || undefined}
                    >
                      {testingId === p.id ? '...' : testResult[p.id] || 'Test'}
                    </button>
                    <label className="toggle-switch"><input type="checkbox" checked={p.enabled} onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })} /><span className="toggle-slider" /></label>
                    <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'provider', id: p.id, name: p.name })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                  </div>
                </div>
              ))}
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
                <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}><option value="openai">{t('settings.providerSection.openai')}</option><option value="claude">{t('settings.providerSection.claude')}</option></select>
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
        )}

        {activeSection === 'models' && (
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
                      <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'model', id: m.id, name: m.label || m.modelId })}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </div>
                  </div>
                )
              })}
              {models.length === 0 && <div className="settings-empty">{t('settings.modelSection.empty')}</div>}
            </div>
            {showAddModel ? (
              <div className="settings-card add-form">
                <select value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}><option value="">{t('settings.modelSection.selectProvider')}</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input placeholder={t('settings.modelSection.modelIdPlaceholder')} value={modelForm.modelId} onChange={(e) => applyModelIdGuess(e.target.value)} />
                <input placeholder={t('settings.modelSection.displayNamePlaceholder')} value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
                <select value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}><option value="low">{t('settings.modelSection.tierLow')}</option><option value="mid">{t('settings.modelSection.tierMid')}</option><option value="high">{t('settings.modelSection.tierHigh')}</option></select>
                <label className="settings-field-label">{t('settings.modelSection.visionLabel')}</label>
                <select value={modelForm.vision} onChange={(e) => setModelForm({ ...modelForm, vision: e.target.value as '' | 'yes' | 'no' })}>
                  <option value="">{t('settings.modelSection.visionAuto')}</option>
                  <option value="yes">{t('settings.modelSection.visionYes')}</option>
                  <option value="no">{t('settings.modelSection.visionNo')}</option>
                </select>
                <div className="settings-row-desc">{t('settings.modelSection.visionHint')}</div>
                <div className="settings-row-desc" style={{ marginTop: 4 }}>{t('settings.modelSection.pricingDesc')}</div>
                <div className="pricing-grid">
                  <input placeholder={t('settings.modelSection.priceInput')} type="number" step="0.01" value={modelForm.input} onChange={(e) => setModelForm({ ...modelForm, input: e.target.value })} />
                  <input placeholder={t('settings.modelSection.priceOutput')} type="number" step="0.01" value={modelForm.output} onChange={(e) => setModelForm({ ...modelForm, output: e.target.value })} />
                  <input placeholder={t('settings.modelSection.priceCacheRead')} type="number" step="0.01" value={modelForm.cacheRead} onChange={(e) => setModelForm({ ...modelForm, cacheRead: e.target.value })} />
                  <input placeholder={t('settings.modelSection.priceCacheWrite')} type="number" step="0.01" value={modelForm.cacheWrite} onChange={(e) => setModelForm({ ...modelForm, cacheWrite: e.target.value })} />
                </div>
                <input placeholder={t('settings.modelSection.contextWindow')} type="number" value={modelForm.contextWindow} onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })} />
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
              <div className="settings-row settings-row-stack">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.visionFallback')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.visionFallbackDesc')}</span>
                </div>
                <select
                  className="vision-fallback-select"
                  value={visionModelId || ''}
                  onChange={(e) => setVisionModel(e.target.value || null)}
                >
                  <option value="">{t('settings.agentSection.visionFallbackAuto')}</option>
                  {visionCandidates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.modelId}
                      {providers.find((p) => p.id === m.providerId) ? ` · ${providers.find((p) => p.id === m.providerId)!.name}` : ''}
                    </option>
                  ))}
                </select>
                {visionCandidates.length === 0 && (
                  <div className="settings-row-desc vision-fallback-warn">
                    {t('settings.agentSection.visionFallbackEmpty')}
                  </div>
                )}
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
              <PermissionsAlwaysPanel />
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.shellSandbox')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.shellSandboxDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={shellSandbox} onChange={(e) => setShellSandbox(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.shellNetwork')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.shellNetworkDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={shellNetwork} onChange={(e) => setShellNetwork(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.cwdJail')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.cwdJailDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={shellCwdJail} onChange={(e) => setShellCwdJail(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.autoMemoryConsolidate')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.autoMemoryConsolidateDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={autoMemoryConsolidate} onChange={(e) => setAutoMemoryConsolidate(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'memory' && (
          <div className="settings-section">
            <h2>{t('settings.memorySection.title')}</h2>
            <p className="settings-desc">{t('settings.memorySection.desc')}</p>
            <MemorySettingsPanel />
          </div>
        )}

        {activeSection === 'hooks' && (
          <div className="settings-section">
            <h2>{t('settings.hooksSection.title')}</h2>
            <p className="settings-desc">{t('settings.hooksSection.desc')}</p>
            <HooksSettingsPanel />
          </div>
        )}

        {activeSection === 'subagents' && (
          <div className="settings-section">
            <h2>{t('settings.agentsSection.title')}</h2>
            <AgentsSettingsPanel />
          </div>
        )}

        {activeSection === 'usage' && (
          <div className="settings-section">
            <h2>{t('settings.usageSection.title')}</h2>
            <UsageSettingsPanel />
            <div className="settings-card" style={{ marginTop: 16 }}>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.usageSection.sessionBudget')}</span>
                  <span className="settings-row-desc">{t('settings.usageSection.sessionBudgetDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 96 }}
                  value={sessionBudgetUsd || ''}
                  placeholder="0"
                  onChange={(e) => setSessionBudgetUsd(Number(e.target.value) || 0)}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.usageSection.dailyBudget')}</span>
                  <span className="settings-row-desc">{t('settings.usageSection.dailyBudgetDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 96 }}
                  value={dailyBudgetUsd || ''}
                  placeholder="0"
                  onChange={(e) => setDailyBudgetUsd(Number(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'plugins' && (
          <div className="settings-section">
            <h2>{t('settings.pluginSection.title')}</h2>
            <p className="settings-desc">{t('settings.pluginSection.desc')}</p>
            <div className="settings-card">
              <div className="plugin-context-head">
                <span className="settings-row-label">{t('settings.pluginSection.contextTitle')}</span>
                <span className="settings-row-desc">
                  {t('settings.pluginSection.contextApplied', {
                    blocks: contextAdditionCount,
                    enabled: enabledSkillCount,
                    total: loadedSkills.length
                  })}
                </span>
              </div>
              <div className="plugin-context-list">
                {contextSignals.map((signal) => (
                  <div key={signal.id} className="plugin-context-item">
                    <div className="plugin-context-main">
                      <span className="plugin-context-label">{t(`settings.pluginSection.sources.${signal.id}`)}</span>
                      <span className="plugin-context-path">{signal.path || t('settings.pluginSection.noProjectPath')}</span>
                    </div>
                    <span className={`plugin-context-status ${signal.detected ? 'ok' : 'off'}`}>
                      {signal.detected ? t('settings.pluginSection.detected') : t('settings.pluginSection.missing')}
                      {signal.details ? ` (${signal.details})` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="plugin-toolbar">
                <div className="plugin-scope-toggle" role="tablist" aria-label={t('settings.pluginSection.scopeLabel')}>
                  {(['all', 'project', 'device', 'builtin'] as SettingsSkillScope[]).map((scope) => (
                    <button
                      key={scope}
                      role="tab"
                      aria-selected={skillScope === scope}
                      className={`plugin-scope-btn ${skillScope === scope ? 'active' : ''}`}
                      onClick={() => setSkillScope(scope)}
                    >
                      {t(`settings.pluginSection.scope.${scope}`)} ({scopeCounts[scope]})
                    </button>
                  ))}
                </div>
                <input
                  className="plugin-search-input"
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder={t('settings.pluginSection.searchPlaceholder')}
                />
              </div>
              {skillsLoading && <div className="settings-empty">{t('common.loading')}</div>}
              {!skillsLoading && visibleSkills.length === 0 && <div className="settings-empty">{t('settings.pluginSection.emptySkills')}</div>}
              {!skillsLoading && visibleSkills.map((skill) => {
                const enabled = isSkillEnabled(skill.name, disabledSkills)
                return (
                  <div key={`${skill.kind}:${skill.source}`} className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-row-label">
                        {skill.name}
                        <span className="plugin-kind">{t(`settings.pluginSection.kind.${skill.kind}`)}</span>
                      </span>
                      <span className="settings-row-desc">{skillSummary(skill) || skill.source}</span>
                      <span className="plugin-source">{skill.source}</span>
                    </div>
                    <div className="settings-row-actions">
                      <label className="toggle-switch">
                        <input type="checkbox" checked={enabled} onChange={() => toggleSkill(skill.name)} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeSection === 'mcp' && (
          <div className="settings-section">
            <h2>{t('settings.mcpSection.title')}</h2>
            <p className="settings-desc">{t('settings.mcpSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row-info" style={{ marginBottom: 8 }}>
                <span className="settings-row-label">{t('settings.mcpSection.templates')}</span>
                <span className="settings-row-desc">
                  One-click install common MCP servers (stdio or HTTP). Add secrets in env after install.
                </span>
              </div>
              <div className="mcp-templates" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {MCP_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="test-btn"
                    title={tpl.description}
                    disabled={mcpAdding || (tpl.scope === 'project' && !projectPath)}
                    onClick={() => {
                      void (async () => {
                        setMcpAdding(true)
                        setMcpFormError(null)
                        const res = await useMcpStore.getState().addServer(
                          tpl.scope,
                          tpl.scope === 'project' ? projectPath || undefined : undefined,
                          tpl.id,
                          tpl.input as McpServerInput
                        )
                        setMcpAdding(false)
                        if (!res.ok) setMcpFormError(res.error || 'Template install failed')
                        else void useMcpStore.getState().refresh(projectPath || undefined)
                      })()
                    }}
                  >
                    + {tpl.name}
                  </button>
                ))}
              </div>
              {mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{t('common.loading')}</div>}
              {!mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{t('settings.mcpSection.empty')}</div>}
              {mcpServers.map((server) => (
                <div key={server.id} className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-label">
                      {server.id}
                      <span className={`mcp-status-badge ${server.disabled ? 'disabled' : server.status}`}>
                        {server.disabled
                          ? t('settings.mcpSection.statusDisabled')
                          : server.status === 'connected'
                            ? t('settings.mcpSection.statusConnected', { count: server.toolCount })
                            : server.status === 'error'
                              ? t('settings.mcpSection.statusError')
                              : t('settings.mcpSection.statusConnecting')}
                      </span>
                    </span>
                    <span className="settings-row-desc">
                      {!server.disabled && server.status === 'error'
                        ? server.error
                        : t(`settings.mcpSection.source.${server.source}`)}
                    </span>
                  </div>
                  <div className="settings-row-actions">
                    {!server.disabled && server.status === 'error' && (
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => void useMcpStore.getState().reconnect(projectPath || undefined)}
                      >
                        {t('settings.mcpSection.retry')}
                      </button>
                    )}
                    <label className="toggle-switch">
                      <input type="checkbox" checked={!server.disabled} onChange={() => void toggleMcpServer(server.id)} />
                      <span className="toggle-slider" />
                    </label>
                    {server.source !== 'user-claude' && (
                      <button className="delete-btn" title={t('common.delete')} onClick={() => void handleRemoveMcpServer(server)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <p className="settings-mcp-hint">{t('settings.mcpSection.hint')}</p>
            </div>

            {showAddMcpServer ? (
              <div className="settings-card add-form">
                <div className="theme-toggle">
                  <button className={mcpScope === 'project' ? 'active' : ''} disabled={!projectPath} onClick={() => setMcpScope('project')}>{t('settings.mcpSection.scopeProject')}</button>
                  <button className={mcpScope === 'user' ? 'active' : ''} onClick={() => setMcpScope('user')}>{t('settings.mcpSection.scopeUser')}</button>
                </div>
                {mcpScope === 'project' && !projectPath && <div className="settings-row-desc">{t('settings.mcpSection.noProjectForScope')}</div>}
                <input placeholder={t('settings.mcpSection.idPlaceholder')} value={mcpForm.id} onChange={(e) => setMcpForm({ ...mcpForm, id: e.target.value })} />
                <input placeholder={t('settings.mcpSection.commandPlaceholder')} value={mcpForm.command} onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })} />
                <input placeholder={t('settings.mcpSection.argsPlaceholder')} value={mcpForm.args} onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })} />
                <textarea
                  className="mcp-env-input"
                  placeholder={t('settings.mcpSection.envPlaceholder')}
                  value={mcpForm.env}
                  onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
                  rows={3}
                />
                {mcpFormError && <div className="settings-row-desc mcp-form-error">{mcpFormError}</div>}
                <div className="form-actions">
                  <button className="btn-primary" onClick={() => void handleAddMcpServer()} disabled={mcpAdding || !mcpForm.id.trim() || !mcpForm.command.trim() || (mcpScope === 'project' && !projectPath)}>
                    {mcpAdding ? t('common.loading') : t('common.save')}
                  </button>
                  <button className="btn-cancel" onClick={() => { setShowAddMcpServer(false); setMcpFormError(null) }}>{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddMcpServer(true)}>{t('settings.mcpSection.add')}</button>
            )}
          </div>
        )}


        {activeSection === 'connections' && (
          <div className="settings-section">
            <h2>{t('settings.connectionsSection.title')}</h2>
            <p className="settings-desc">{t('settings.connectionsSection.desc')}</p>

            <div className="settings-card conn-card">
              {(['google', 'github', 'gitlab', 'codecommit'] as const).map((provider) => {
                const st = connStatus.find((s) => s.provider === provider)
                const connected = !!st?.connected
                const ready = st?.clientConfigured !== false
                const busy = connBusy === provider
                const isPat = provider === 'gitlab' || provider === 'codecommit'
                const patOpen = isPat && patFormOpen === provider
                return (
                  <div key={provider} className="conn-provider-block">
                    <div className="settings-row conn-row">
                      <div className="conn-brand">
                        {provider === 'google' ? (
                          <span className="conn-logo conn-logo-google" aria-hidden>
                            <svg width="22" height="22" viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                          </span>
                        ) : provider === 'github' ? (
                          <span className="conn-logo conn-logo-github" aria-hidden>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                            </svg>
                          </span>
                        ) : provider === 'gitlab' ? (
                          <span className="conn-logo conn-logo-gitlab" aria-hidden>
                            <img src={logoGitlab} alt="" width={22} height={22} draggable={false} />
                          </span>
                        ) : (
                          <span className="conn-logo conn-logo-codecommit" aria-hidden>
                            <img src={logoCodeCommit} alt="" width={40} height={40} draggable={false} />
                          </span>
                        )}
                        <div className="settings-row-info">
                          <span className="settings-row-label">
                            {connProviderLabel(provider)}
                            {isPat && (
                              <span className="settings-badge conn-pat-badge">
                                {t('settings.connectionsSection.patBadge')}
                              </span>
                            )}
                            {connected && (
                              <span className="settings-badge conn-account-badge">
                                {st?.accountLabel || t('settings.connectionsSection.statusConnected')}
                              </span>
                            )}
                          </span>
                          <span className="settings-row-desc">
                            {connected
                              ? t('settings.connectionsSection.statusConnectedDesc')
                              : busy && !isPat
                                ? t('settings.connectionsSection.waitingBrowser')
                                : isPat
                                  ? t('settings.connectionsSection.statusDisconnectedPat')
                                  : t('settings.connectionsSection.statusDisconnected')}
                            {provider === 'google' && connected && st?.writeScopesReady === false && (
                              <span className="conn-write-scope-warn">
                                {' '}
                                · Write scopes missing
                                {st.writeScopesMissing?.length
                                  ? ` (${st.writeScopesMissing.join(', ')})`
                                  : ''}
                                . Disconnect → Connect to enable Gmail send / Sheets write / Calendar create.
                              </span>
                            )}
                            {provider === 'google' && connected && st?.writeScopesReady === true && (
                              <span className="conn-write-scope-ok"> · Write scopes ready</span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="settings-row-actions">
                        {connected ? (
                          <button
                            className="test-btn"
                            disabled={busy}
                            onClick={() => void handleDisconnect(provider)}
                          >
                            {t('settings.connectionsSection.disconnect')}
                          </button>
                        ) : busy && !isPat ? (
                          <button
                            className="test-btn conn-cancel-btn"
                            onClick={() => void handleCancelConnect(provider)}
                          >
                            {t('settings.connectionsSection.cancel')}
                          </button>
                        ) : isPat ? (
                          <button
                            className={`btn-primary conn-connect-btn conn-connect-${provider}`}
                            disabled={busy}
                            onClick={() => {
                              if (patOpen) setPatFormOpen(null)
                              else openPatForm(provider)
                            }}
                          >
                            {patOpen
                              ? t('settings.connectionsSection.cancel')
                              : t('settings.connectionsSection.connect')}
                          </button>
                        ) : (
                          <button
                            className={`btn-primary conn-connect-btn conn-connect-${provider}`}
                            disabled={!ready}
                            onClick={() => void handleConnect(provider)}
                          >
                            {t('settings.connectionsSection.connect')}
                          </button>
                        )}
                      </div>
                    </div>

                    {patOpen && (
                      <div className="conn-pat-panel">
                        <div className="conn-pat-title">
                          {provider === 'gitlab'
                            ? t('settings.connectionsSection.gitlabPatTitle')
                            : t('settings.connectionsSection.codecommitPatTitle')}
                        </div>
                        <p className="conn-pat-hint">
                          {provider === 'gitlab'
                            ? t('settings.connectionsSection.gitlabPatHint')
                            : t('settings.connectionsSection.codecommitPatHint')}
                        </p>
                        {provider === 'gitlab' ? (
                          <div className="conn-pat-fields">
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.baseUrl')}</span>
                              <input
                                type="url"
                                autoComplete="off"
                                placeholder="https://gitlab.example.com"
                                value={patForm.baseUrl}
                                onChange={(e) => setPatForm((f) => ({ ...f, baseUrl: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.personalToken')}</span>
                              <input
                                type="password"
                                autoComplete="off"
                                placeholder="glpat-…"
                                value={patForm.token}
                                onChange={(e) => setPatForm((f) => ({ ...f, token: e.target.value }))}
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="conn-pat-fields">
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsRegion')}</span>
                              <input
                                type="text"
                                autoComplete="off"
                                placeholder="ap-northeast-2"
                                value={patForm.region}
                                onChange={(e) => setPatForm((f) => ({ ...f, region: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsAccessKeyId')}</span>
                              <input
                                type="text"
                                autoComplete="off"
                                placeholder="AKIA…"
                                value={patForm.accessKeyId}
                                onChange={(e) => setPatForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsSecretAccessKey')}</span>
                              <input
                                type="password"
                                autoComplete="off"
                                value={patForm.secretAccessKey}
                                onChange={(e) => setPatForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsSessionToken')}</span>
                              <input
                                type="password"
                                autoComplete="off"
                                placeholder={t('settings.connectionsSection.optional')}
                                value={patForm.sessionToken}
                                onChange={(e) => setPatForm((f) => ({ ...f, sessionToken: e.target.value }))}
                              />
                            </label>
                          </div>
                        )}
                        <div className="conn-pat-actions">
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={
                              busy ||
                              (provider === 'gitlab'
                                ? !patForm.baseUrl.trim() || !patForm.token.trim()
                                : !patForm.region.trim() ||
                                  !patForm.accessKeyId.trim() ||
                                  !patForm.secretAccessKey.trim())
                            }
                            onClick={() => void handleConnectPat(provider)}
                          >
                            {busy
                              ? t('settings.connectionsSection.connecting')
                              : t('settings.connectionsSection.saveConnect')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {deviceAuth && (
                <div className="conn-device-panel">
                  <div className="conn-device-title">{t('settings.connectionsSection.deviceTitle')}</div>
                  <div className="conn-device-hint">
                    {t('settings.connectionsSection.deviceHint', {
                      uri: deviceAuth.verificationUri.replace(/^https?:\/\//, '')
                    })}
                  </div>
                  <div className="conn-device-code-row">
                    <code className="conn-device-code">{deviceAuth.userCode}</code>
                    <button type="button" className="test-btn" onClick={() => void copyDeviceCode()}>
                      {t('settings.connectionsSection.copyCode')}
                    </button>
                  </div>
                  <a
                    className="conn-device-link"
                    href={deviceAuth.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.open(deviceAuth.verificationUri, '_blank')
                    }}
                  >
                    {t('settings.connectionsSection.openDevicePage')}
                  </a>
                </div>
              )}

              {connMsg && !deviceAuth && (
                <div className="conn-msg">{connMsg}</div>
              )}
              <p className="settings-row-desc conn-privacy">{t('settings.connectionsSection.privacyNote')}</p>
            </div>
          </div>
        )}

        {activeSection === 'system' && (
          <div className="settings-section">
            <h2>{t('settings.systemSection.title')}</h2>
            <p className="settings-desc">{t('settings.systemSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.systemSection.sleepPrevention')}</span><span className="settings-row-desc">{t('settings.systemSection.sleepPreventionDesc')}</span></div>
                <div className="theme-toggle">
                  <button className={sleepPrevention === 'off' ? 'active' : ''} onClick={() => setSleepPrevention('off')}>{t('settings.systemSection.sleepOff')}</button>
                  <button className={sleepPrevention === 'sleep' ? 'active' : ''} onClick={() => setSleepPrevention('sleep')}>{t('settings.systemSection.sleepSystem')}</button>
                  <button className={sleepPrevention === 'display' ? 'active' : ''} onClick={() => setSleepPrevention('display')}>{t('settings.systemSection.sleepDisplay')}</button>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.systemSection.taskNotifications')}</span><span className="settings-row-desc">{t('settings.systemSection.taskNotificationsDesc')}</span></div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={taskNotificationsEnabled}
                    onChange={(e) => setTaskNotificationsEnabled(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.systemSection.trayEnabled')}</span><span className="settings-row-desc">{t('settings.systemSection.trayEnabledDesc')}</span></div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={trayVisible}
                    onChange={(e) => {
                      const next = e.target.checked
                      setTrayVisible(next)
                      void window.api.tray?.setEnabled?.(next)?.catch?.(() => {})
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.systemSection.confirmQuit')}</span>
                  <span className="settings-row-desc">{t('settings.systemSection.confirmQuitDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={confirmQuit}
                    onChange={(e) => setConfirmQuit(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.systemSection.checkUpdatesOnLaunch')}</span>
                  <span className="settings-row-desc">{t('settings.systemSection.checkUpdatesOnLaunchDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={checkUpdatesOnLaunch}
                    onChange={(e) => setCheckUpdatesOnLaunch(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.systemSection.checkUpdates')}</span>
                  <span className="settings-row-desc">
                    {updateMsg || t('settings.systemSection.checkUpdatesDesc')}
                  </span>
                </div>
                <div className="settings-row-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-action"
                    disabled={updateChecking}
                    onClick={() => {
                      if (!window.api?.checkForUpdates) {
                        setUpdateMsg(t('settings.systemSection.desktopOnly'))
                        return
                      }
                      setUpdateChecking(true)
                      void window.api
                        .checkForUpdates()
                        .then((r) => {
                          if (r.error && !r.latest) {
                            setUpdateMsg(r.error)
                            return
                          }
                          if (r.updateAvailable) {
                            setUpdateMsg(
                              t('settings.systemSection.updateAvailable', {
                                latest: r.latest,
                                current: r.current
                              })
                            )
                          } else {
                            setUpdateMsg(
                              t('settings.systemSection.upToDate', { current: r.current })
                            )
                          }
                        })
                        .catch((e) => setUpdateMsg(String(e)))
                        .finally(() => setUpdateChecking(false))
                    }}
                  >
                    {updateChecking
                      ? t('settings.systemSection.checking')
                      : t('settings.systemSection.checkUpdates')}
                  </button>
                  <button
                    type="button"
                    className="btn-action"
                    disabled={updateChecking}
                    onClick={() => {
                      if (!window.api?.downloadUpdate) {
                        setUpdateMsg(t('settings.systemSection.desktopOnly'))
                        return
                      }
                      setUpdateChecking(true)
                      setUpdateMsg(t('settings.systemSection.downloading'))
                      void window.api
                        .downloadUpdate()
                        .then((r) => {
                          if (r.alreadyLatest) {
                            setUpdateMsg(
                              t('settings.systemSection.upToDate', {
                                current: r.current || ''
                              })
                            )
                            return
                          }
                          if (r.ok && r.path) {
                            setUpdateMsg(
                              t('settings.systemSection.downloadOpened', { path: r.path })
                            )
                          } else {
                            setUpdateMsg(r.error || t('settings.systemSection.downloadFailed'))
                          }
                        })
                        .catch((e) => setUpdateMsg(String(e)))
                        .finally(() => setUpdateChecking(false))
                    }}
                  >
                    {t('settings.systemSection.downloadInstall')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'shortcuts' && (
          <div className="settings-section">
            <h2>{t('settings.shortcutSection.title')}</h2>
            <p className="settings-desc">{t('settings.shortcutSection.desc')}</p>
            <div className="settings-card">
              {KEYBINDING_IDS.map((id) => {
                const conflict = comboConflict(id)
                return (
                  <div key={id} className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-row-label">{shortcutLabel(id)}</span>
                      <span className="settings-row-desc">
                        {recording === id
                          ? t('settings.shortcutSection.recording')
                          : conflict
                            ? t('settings.shortcutSection.conflict', { other: shortcutLabel(conflict) })
                            : keybindings[id] ? formatCombo(keybindings[id]) : t('settings.shortcutSection.none')}
                      </span>
                    </div>
                    <div className="settings-row-actions">
                      <button className={`test-btn ${recording === id ? 'ok' : ''}`} onClick={() => setRecording(recording === id ? null : id)}>
                        {recording === id ? t('settings.shortcutSection.cancel') : t('settings.shortcutSection.change')}
                      </button>
                      <button className="test-btn" onClick={() => resetKeybinding(id)} disabled={keybindings[id] === DEFAULT_KEYBINDINGS[id]}>
                        {t('settings.shortcutSection.reset')}
                      </button>
                    </div>
                  </div>
                )
              })}
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
                <button className="btn-action" onClick={() => { const data = { _note: t('settings.dataSection.exportKeyNote'), providers: providers.map((p) => { const { apiKey, ...rest } = p; return rest }), models, settings: { routingMode, defaultSendMode } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'pawn-settings.json'; a.click(); URL.revokeObjectURL(url) }}>{t('settings.dataSection.export')}</button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.import')}</span>
                  <span className="settings-row-desc">
                    {importMsg || t('settings.dataSection.importDesc')}
                  </span>
                </div>
                <button
                  className="btn-action"
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.json'
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0]
                      if (!file) return
                      const text = await file.text()
                      try {
                        const data = JSON.parse(text) as {
                          providers?: typeof providers
                          models?: typeof models
                        }
                        const store = useProviderStore.getState()
                        let n = 0
                        if (Array.isArray(data.providers)) {
                          data.providers.forEach((p) => {
                            store.addProvider(p)
                            n++
                          })
                        }
                        if (Array.isArray(data.models)) {
                          data.models.forEach((m) => {
                            store.addModel(m)
                            n++
                          })
                        }
                        if (n === 0) {
                          setImportMsg(t('settings.dataSection.importEmpty'))
                        } else {
                          setImportMsg(t('settings.dataSection.importOk', { count: n }))
                        }
                      } catch (err) {
                        setImportMsg(
                          t('settings.dataSection.importFailed', {
                            error: err instanceof Error ? err.message : String(err)
                          })
                        )
                      }
                    }
                    input.click()
                  }}
                >
                  {t('settings.dataSection.import')}
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.fullBackup')}</span>
                  <span className="settings-row-desc">
                    {backupMsg || t('settings.dataSection.fullBackupDesc')}
                  </span>
                </div>
                <div className="settings-row-actions" style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-action"
                    onClick={() => {
                      if (!window.api?.exportBackup) {
                        setBackupMsg(t('settings.dataSection.desktopOnly'))
                        return
                      }
                      void window.api.exportBackup({ excludeSecrets: true }).then((r) => {
                        if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                        else if (r.ok && r.path)
                          setBackupMsg(
                            t('settings.dataSection.backupOkSafe', { path: r.path })
                          )
                        else setBackupMsg(r.error || t('settings.dataSection.backupFailed'))
                      }).catch(() => setBackupMsg(t('settings.dataSection.backupFailed')))
                    }}
                  >
                    {t('settings.dataSection.fullBackupSafe')}
                  </button>
                  <button
                    className="btn-action"
                    onClick={() => {
                      if (!window.api?.exportBackup) {
                        setBackupMsg(t('settings.dataSection.desktopOnly'))
                        return
                      }
                      if (!window.confirm(t('settings.dataSection.backupFullConfirm'))) return
                      void window.api.exportBackup({ excludeSecrets: false }).then((r) => {
                        if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                        else if (r.ok && r.path)
                          setBackupMsg(t('settings.dataSection.backupOk', { path: r.path }))
                        else setBackupMsg(r.error || t('settings.dataSection.backupFailed'))
                      }).catch(() => setBackupMsg(t('settings.dataSection.backupFailed')))
                    }}
                  >
                    {t('settings.dataSection.fullBackup')}
                  </button>
                  <button
                    className="btn-action"
                    onClick={() => {
                      if (!window.api?.importBackup) {
                        setBackupMsg(t('settings.dataSection.desktopOnly'))
                        return
                      }
                      if (!window.confirm(t('settings.dataSection.restoreConfirm'))) return
                      void window.api.importBackup().then((r) => {
                        if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                        else if (r.ok)
                          setBackupMsg(
                            t('settings.dataSection.restoreOk', {
                              path: r.backupOfPrevious || ''
                            })
                          )
                        else setBackupMsg(r.error || t('settings.dataSection.restoreFailed'))
                      }).catch(() => setBackupMsg(t('settings.dataSection.restoreFailed')))
                    }}
                  >
                    {t('settings.dataSection.restoreBackup')}
                  </button>
                </div>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.configFile')}</span>
                  <span className="settings-row-desc">{t('settings.dataSection.configFileDesc')}</span>
                  {pawnPaths?.configPath && <span className="plugin-source">{pawnPaths.configPath}</span>}
                </div>
                <div className="settings-row-actions">
                  <button className="btn-action" disabled={!pawnPaths?.configPath} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.configPath) }}>
                    {t('settings.dataSection.open')}
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.database')}</span>
                  <span className="settings-row-desc">{t('settings.dataSection.databaseDesc')}</span>
                  {pawnPaths?.dataDir && <span className="plugin-source">{pawnPaths.dataDir}</span>}
                </div>
                <div className="settings-row-actions">
                  <button className="btn-action" disabled={!pawnPaths?.dataDir} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.dataDir) }}>
                    {t('settings.dataSection.open')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete.name} ${t('common.delete')}`}
          message={
            confirmDelete.type === 'provider'
              ? t('confirmDialog.deleteProviderConfirm')
              : t('confirmDialog.deleteModelConfirm')
          }
          confirmLabel={t('confirmDialog.confirm')}
          cancelLabel={t('confirmDialog.cancel')}
          onConfirm={() => { void handleConfirmDelete() }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
