import { useState } from 'react'
import PermissionsAlwaysPanel from './PermissionsAlwaysPanel'
import type { SettingsState } from './settingsState'
import { useProviderStore } from '../stores/provider'
import { HARNESS_MODES } from '../agent/harnessMode'

export default function AgentSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
    t,
    routingMode,
    setRoutingMode,
    visionModelId,
    setVisionModel,
    visionCandidates,
    providers,
    defaultSendMode,
    setDefaultSendMode,
    permissionMode,
    setPermissionMode,
    shellSandbox,
    setShellSandbox,
    shellNetwork,
    setShellNetwork,
    shellCwdJail,
    setShellCwdJail,
    autoMemoryConsolidate,
    setAutoMemoryConsolidate
  } = state
  const harnessMode = useProviderStore((s) => s.harnessMode)
  const setHarnessMode = useProviderStore((s) => s.setHarnessMode)
  const smartCompaction = useProviderStore((s) => s.smartCompaction)
  const setSmartCompaction = useProviderStore((s) => s.setSmartCompaction)
  const toolLoading = useProviderStore((s) => s.toolLoading)
  const setToolLoading = useProviderStore((s) => s.setToolLoading)
  const nativeCodingTools = useProviderStore((s) => s.nativeCodingTools)
  const setNativeCodingTools = useProviderStore((s) => s.setNativeCodingTools)
  const nativeComputerTool = useProviderStore((s) => s.nativeComputerTool)
  const setNativeComputerTool = useProviderStore((s) => s.setNativeComputerTool)
  const [computerInfo, setComputerInfo] = useState<string | null>(null)
  const [computerBusy, setComputerBusy] = useState(false)
  const lspDiagnostics = useProviderStore((s) => s.lspDiagnostics)
  const setLspDiagnostics = useProviderStore((s) => s.setLspDiagnostics)
  const models = useProviderStore((s) => s.models)

  // A mode only feels different in auto routing when there are tiers to move between.
  const enabledProviderIds = new Set(providers.filter((p) => p.enabled).map((p) => p.id))
  const tiers = new Set(
    models.filter((m) => m.enabled && enabledProviderIds.has(m.providerId)).map((m) => m.tier)
  )
  const harnessTierHint =
    routingMode !== 'auto'
      ? t('settings.agentSection.harnessManualHint')
      : harnessMode === 'maxing' && !tiers.has('high')
        ? t('settings.agentSection.harnessNoHighTier')
        : harnessMode === 'eco' && !tiers.has('low')
          ? t('settings.agentSection.harnessNoLowTier')
          : ''

  return (
    <div className="settings-section">
      <h2>{t('settings.agentSection.title')}</h2>
      <p className="settings-desc">{t('settings.agentSection.desc')}</p>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.routing')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.routingDesc')}</span>
          </div>
          <div className="theme-toggle">
            <button className={routingMode === 'auto' ? 'active' : ''} onClick={() => setRoutingMode('auto')}>{t('statusBar.auto')}</button>
            <button className={routingMode === 'manual' ? 'active' : ''} onClick={() => setRoutingMode('manual')}>{t('statusBar.manual')}</button>
          </div>
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
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.sendMode')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.sendModeDesc')}</span>
          </div>
          <select value={defaultSendMode} onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}>
            <option value="queue">{t('settings.agentSection.queue')}</option>
            <option value="steer">{t('settings.agentSection.steer')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.permissionMode')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.permissionModeDesc')}</span>
          </div>
          <div className="theme-toggle">
            <button className={permissionMode === 'ask' ? 'active' : ''} onClick={() => setPermissionMode('ask')}>{t('permission.ask')}</button>
            <button className={permissionMode === 'auto' ? 'active' : ''} onClick={() => setPermissionMode('auto')}>{t('permission.auto')}</button>
            <button className={permissionMode === 'yolo' ? 'active' : ''} onClick={() => setPermissionMode('yolo')}>{t('permission.yolo')}</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.harnessMode')}</span>
            <span className="settings-row-desc">{t(`settings.agentSection.harnessDesc_${harnessMode}`)}</span>
            {harnessTierHint && harnessMode !== 'default' && (
              <span className="settings-row-desc vision-fallback-warn">{harnessTierHint}</span>
            )}
          </div>
          <div className="theme-toggle" role="group" aria-label={t('settings.agentSection.harnessMode')}>
            {HARNESS_MODES.map((m) => (
              <button
                key={m}
                className={harnessMode === m ? 'active' : ''}
                aria-pressed={harnessMode === m}
                onClick={() => setHarnessMode(m)}
              >
                {t(`settings.agentSection.harness_${m}`)}
              </button>
            ))}
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
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.toolLoading')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.toolLoadingDesc')}</span>
          </div>
          <select
            className="settings-select"
            value={toolLoading}
            onChange={(e) => setToolLoading(e.target.value === 'all' ? 'all' : 'smart')}
          >
            <option value="smart">{t('settings.agentSection.toolLoadingSmart')}</option>
            <option value="all">{t('settings.agentSection.toolLoadingAll')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.smartCompaction')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.smartCompactionDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={smartCompaction} onChange={(e) => setSmartCompaction(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.computerUse')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.computerUseDesc')}</span>
            {computerInfo && <span className="settings-row-desc computer-status-line">{computerInfo}</span>}
          </div>
          <button
            type="button"
            className="test-btn"
            disabled={computerBusy}
            onClick={() => {
              const status = window.api?.computer?.status
              if (!status) {
                setComputerInfo(t('settings.agentSection.computerUnavailable'))
                return
              }
              setComputerBusy(true)
              setComputerInfo(t('settings.agentSection.computerSettingUp'))
              void status({ prompt: true })
                .then((r) =>
                  setComputerInfo(
                    r.ok
                      ? t('settings.agentSection.computerReady', { backend: r.backend, version: r.version || '' })
                      : r.errors.join(' · ')
                  )
                )
                .catch((e) => setComputerInfo(String(e)))
                .finally(() => setComputerBusy(false))
            }}
          >
            {computerBusy ? t('settings.agentSection.computerSettingUpShort') : t('settings.agentSection.computerCheck')}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.nativeCodingTools')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.nativeCodingToolsDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={nativeCodingTools} onChange={(e) => setNativeCodingTools(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.nativeComputerTool')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.nativeComputerToolDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={nativeComputerTool} onChange={(e) => setNativeComputerTool(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.lspDiagnostics')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.lspDiagnosticsDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={lspDiagnostics} onChange={(e) => setLspDiagnostics(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </div>
  )
}
