import { useState } from 'react'
import PermissionsAlwaysPanel from './PermissionsAlwaysPanel'
import type { SettingsState } from './settingsState'
import { useProviderStore } from '../stores/provider'
import { HARNESS_MODES } from '../agent/harnessMode'
import Select from './Select'
import Switch from './Switch'

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
    setShellCwdJail
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
        <div className="settings-subheader">{t('settings.agentSection.groupBehavior')}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.routing')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.routingDesc')}</span>
          </div>
          <div className="theme-toggle" role="group" aria-label={t('settings.agentSection.routing')}>
            <button className={routingMode === 'auto' ? 'active' : ''} aria-pressed={routingMode === 'auto'} onClick={() => setRoutingMode('auto')}>{t('statusBar.auto')}</button>
            <button className={routingMode === 'manual' ? 'active' : ''} aria-pressed={routingMode === 'manual'} onClick={() => setRoutingMode('manual')}>{t('statusBar.manual')}</button>
          </div>
        </div>
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.visionFallback')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.visionFallbackDesc')}</span>
          </div>
          <Select
            className="vision-fallback-select"
            aria-label={t('settings.agentSection.visionFallback')}
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
          </Select>
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
          <Select
            aria-label={t('settings.agentSection.sendMode')}
            value={defaultSendMode}
            onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}
          >
            <option value="queue">{t('settings.agentSection.queue')}</option>
            <option value="steer">{t('settings.agentSection.steer')}</option>
          </Select>
        </div>
        <div className="settings-subheader">{t('settings.agentSection.groupSafety')}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.permissionMode')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.permissionModeDesc')}</span>
            {permissionMode === 'yolo' && (
              <span className="settings-row-desc vision-fallback-warn">{t('settings.agentSection.yoloWarn')}</span>
            )}
          </div>
          <div className="theme-toggle" role="group" aria-label={t('settings.agentSection.permissionMode')}>
            <button className={permissionMode === 'ask' ? 'active' : ''} aria-pressed={permissionMode === 'ask'} onClick={() => setPermissionMode('ask')}>{t('permission.ask')}</button>
            <button className={permissionMode === 'auto' ? 'active' : ''} aria-pressed={permissionMode === 'auto'} onClick={() => setPermissionMode('auto')}>{t('permission.auto')}</button>
            <button className={permissionMode === 'yolo' ? 'active' : ''} aria-pressed={permissionMode === 'yolo'} onClick={() => setPermissionMode('yolo')}>{t('permission.yolo')}</button>
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
          <Switch
            checked={shellSandbox}
            onCheckedChange={setShellSandbox}
            aria-label={t('settings.agentSection.shellSandbox')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.shellNetwork')}</span>
            <span className="settings-row-desc">
              {shellSandbox
                ? t('settings.agentSection.shellNetworkDesc')
                : t('settings.agentSection.shellNetworkNeedsSandbox')}
            </span>
          </div>
          <Switch
            checked={shellNetwork}
            onCheckedChange={setShellNetwork}
            disabled={!shellSandbox}
            aria-label={t('settings.agentSection.shellNetwork')}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.cwdJail')}</span>
            <span className="settings-row-desc">
              {shellSandbox ? t('settings.agentSection.cwdJailDesc') : t('settings.agentSection.shellNetworkNeedsSandbox')}
            </span>
          </div>
          <Switch
            checked={shellCwdJail}
            onCheckedChange={setShellCwdJail}
            disabled={!shellSandbox}
            aria-label={t('settings.agentSection.cwdJail')}
          />
        </div>
        <div className="settings-subheader">{t('settings.agentSection.groupContext')}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.toolLoading')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.toolLoadingDesc')}</span>
          </div>
          <Select
            className="settings-select"
            aria-label={t('settings.agentSection.toolLoading')}
            value={toolLoading}
            onChange={(e) => setToolLoading(e.target.value === 'all' ? 'all' : 'smart')}
          >
            <option value="smart">{t('settings.agentSection.toolLoadingSmart')}</option>
            <option value="all">{t('settings.agentSection.toolLoadingAll')}</option>
          </Select>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.smartCompaction')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.smartCompactionDesc')}</span>
          </div>
          <Switch checked={smartCompaction} onCheckedChange={setSmartCompaction} aria-label={t('settings.agentSection.smartCompaction')} />
        </div>
        <div className="settings-subheader">{t('settings.agentSection.groupTools')}</div>
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
                      : t('settings.agentSection.computerFailed', { detail: r.errors.join(' · ').slice(0, 160) })
                  )
                )
                .catch((e) => {
                  console.warn('[agent-settings]', e)
                  setComputerInfo(t('common.operationFailed'))
                })
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
          <Switch checked={nativeCodingTools} onCheckedChange={setNativeCodingTools} aria-label={t('settings.agentSection.nativeCodingTools')} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.nativeComputerTool')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.nativeComputerToolDesc')}</span>
          </div>
          <Switch checked={nativeComputerTool} onCheckedChange={setNativeComputerTool} aria-label={t('settings.agentSection.nativeComputerTool')} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentSection.lspDiagnostics')}</span>
            <span className="settings-row-desc">{t('settings.agentSection.lspDiagnosticsDesc')}</span>
          </div>
          <Switch checked={lspDiagnostics} onCheckedChange={setLspDiagnostics} aria-label={t('settings.agentSection.lspDiagnostics')} />
        </div>
      </div>
    </div>
  )
}
