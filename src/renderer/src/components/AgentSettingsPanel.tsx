import { useState } from 'react'
import PermissionsAlwaysPanel from './PermissionsAlwaysPanel'
import type { SettingsState } from './settingsState'
import { useProviderStore } from '../stores/provider'
import { HARNESS_MODES } from '../agent/harnessMode'
import Select from './Select'
import Switch from './Switch'
import { tx } from '../i18n'

export default function AgentSettingsPanel({ state }: { state: SettingsState }): React.JSX.Element {
  const {
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
      ? 'Manual routing: model choice stays pinned; other mode effects still apply.'
      : harnessMode === 'maxing' && !tiers.has('high')
        ? 'No high-tier model enabled, so Maxing model picks will feel similar.'
        : harnessMode === 'eco' && !tiers.has('low')
          ? 'No low-tier model enabled, so Eco model picks will feel similar.'
          : ''

  return (
    <div className="settings-section">
      <h2>{'Agent'}</h2>
      <p className="settings-desc">{'Routing, permissions, and shell safety for the main agent'}</p>
      <div className="settings-card">
        <div className="settings-subheader">{'Run behavior'}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Model routing'}</span>
            <span className="settings-row-desc">{'Automatically route tasks to the best available model'}</span>
          </div>
          <div className="theme-toggle" role="group" aria-label={'Model routing'}>
            <button className={routingMode === 'auto' ? 'active' : ''} aria-pressed={routingMode === 'auto'} onClick={() => setRoutingMode('auto')}>{'Auto'}</button>
            <button className={routingMode === 'manual' ? 'active' : ''} aria-pressed={routingMode === 'manual'} onClick={() => setRoutingMode('manual')}>{'Manual'}</button>
          </div>
        </div>
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Vision fallback model'}</span>
            <span className="settings-row-desc">{'Optional. Used only when the active model cannot handle images (attachments or screenshots). If your main model already has vision (e.g. Gemini), leave this on Auto — nothing extra is needed.'}</span>
          </div>
          <Select
            className="vision-fallback-select"
            aria-label={'Vision fallback model'}
            value={visionModelId || ''}
            onChange={(e) => setVisionModel(e.target.value || null)}
          >
            <option value="">{'Auto — any vision-capable model'}</option>
            {visionCandidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.modelId}
                {providers.find((p) => p.id === m.providerId) ? ` · ${providers.find((p) => p.id === m.providerId)!.name}` : ''}
              </option>
            ))}
          </Select>
          {visionCandidates.length === 0 && (
            <div className="settings-row-desc vision-fallback-warn">
              {'No vision-capable models yet. Add one under Models and set Vision to Yes (or use a Gemini/GPT-4o/Claude preset).'}
            </div>
          )}
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Send mode'}</span>
            <span className="settings-row-desc">{'Choose how messages are sent to the agent'}</span>
          </div>
          <Select
            aria-label={'Send mode'}
            value={defaultSendMode}
            onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}
          >
            <option value="queue">{'Queue'}</option>
            <option value="steer">{'Steer'}</option>
          </Select>
        </div>
        <div className="settings-subheader">{'Safety & approvals'}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Permission mode'}</span>
            <span className="settings-row-desc">{'Control how the agent asks for permissions'}</span>
            {permissionMode === 'yolo' && (
              <span className="settings-row-desc vision-fallback-warn">{'YOLO runs every tool without asking. Only use in throwaway environments.'}</span>
            )}
          </div>
          <div className="theme-toggle" role="group" aria-label={'Permission mode'}>
            <button className={permissionMode === 'ask' ? 'active' : ''} aria-pressed={permissionMode === 'ask'} onClick={() => setPermissionMode('ask')}>{'Ask'}</button>
            <button className={permissionMode === 'auto' ? 'active' : ''} aria-pressed={permissionMode === 'auto'} onClick={() => setPermissionMode('auto')}>{'Auto-approve'}</button>
            <button className={permissionMode === 'yolo' ? 'active' : ''} aria-pressed={permissionMode === 'yolo'} onClick={() => setPermissionMode('yolo')}>{'Full auto'}</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Harness mode'}</span>
            <span className="settings-row-desc">{tx(`settings.agentSection.harnessDesc_${harnessMode}`)}</span>
            {harnessTierHint && harnessMode !== 'default' && (
              <span className="settings-row-desc vision-fallback-warn">{harnessTierHint}</span>
            )}
          </div>
          <div className="theme-toggle" role="group" aria-label={'Harness mode'}>
            {HARNESS_MODES.map((m) => (
              <button
                key={m}
                className={harnessMode === m ? 'active' : ''}
                aria-pressed={harnessMode === m}
                onClick={() => setHarnessMode(m)}
              >
                {tx(`settings.agentSection.harness_${m}`)}
              </button>
            ))}
          </div>
        </div>
        <PermissionsAlwaysPanel />
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Shell sandbox'}</span>
            <span className="settings-row-desc">{'Env allowlist + dangerous-command block for agent shell_exec (default on)'}</span>
          </div>
          <Switch
            checked={shellSandbox}
            onCheckedChange={setShellSandbox}
            aria-label={'Shell sandbox'}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Shell network'}</span>
            <span className="settings-row-desc">
              {shellSandbox
                ? 'Allow network in sandboxed shells (off uses sandbox-exec on macOS when possible)'
                : 'Only applies while the shell sandbox is on.'}
            </span>
          </div>
          <Switch
            checked={shellNetwork}
            onCheckedChange={setShellNetwork}
            disabled={!shellSandbox}
            aria-label={'Shell network'}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'CWD jail'}</span>
            <span className="settings-row-desc">
              {shellSandbox ? 'Refuse shell cwd outside the project root' : 'Only applies while the shell sandbox is on.'}
            </span>
          </div>
          <Switch
            checked={shellCwdJail}
            onCheckedChange={setShellCwdJail}
            disabled={!shellSandbox}
            aria-label={'CWD jail'}
          />
        </div>
        <div className="settings-subheader">{'Context & compaction'}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Tool loading'}</span>
            <span className="settings-row-desc">{'Smart sends core coding tools always and loads browser, computer, account (GitHub/GitLab/Google/CodeCommit) and app tools only when a chat needs them — about half the tool tokens per request. All sends every tool.'}</span>
          </div>
          <Select
            className="settings-select"
            aria-label={'Tool loading'}
            value={toolLoading}
            onChange={(e) => setToolLoading(e.target.value === 'all' ? 'all' : 'smart')}
          >
            <option value="smart">{'Smart (on demand)'}</option>
            <option value="all">{'All tools'}</option>
          </Select>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Smart compaction'}</span>
            <span className="settings-row-desc">{'When the context fills up, the cheapest enabled model writes a handoff summary (goal, decisions, changed files, open work). Off = free heuristic digest.'}</span>
          </div>
          <Switch checked={smartCompaction} onCheckedChange={setSmartCompaction} aria-label={'Smart compaction'} />
        </div>
        <div className="settings-subheader">{'Models & tools'}</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Computer use'}</span>
            <span className="settings-row-desc">{'Control apps on this Mac: accessibility-tree actions, screenshots and zoom, OCR, mouse and keyboard, windows and menus. Needs Accessibility and Screen Recording permission. Press Esc twice to stop the agent.'}</span>
            {computerInfo && <span className="settings-row-desc computer-status-line">{computerInfo}</span>}
          </div>
          <button
            type="button"
            className="test-btn"
            disabled={computerBusy}
            onClick={() => {
              const status = window.api?.computer?.status
              if (!status) {
                setComputerInfo('Computer use is only available in the desktop app.')
                return
              }
              setComputerBusy(true)
              setComputerInfo('Setting up… preparing the helper and opening permission prompts. Turn on Pawn in System Settings.')
              void status({ prompt: true })
                .then((r) =>
                  setComputerInfo(
                    r.ok
                      ? `Ready — ${r.backend} helper ${r.version || ''}`
                      : `Check failed: ${r.errors.join(' · ').slice(0, 160)}`
                  )
                )
                .catch((e) => {
                  console.warn('[agent-settings]', e)
                  setComputerInfo('Something failed — see the console for details.')
                })
                .finally(() => setComputerBusy(false))
            }}
          >
            {computerBusy ? 'Setting up…' : 'Check & grant permissions'}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Model-native coding tools'}</span>
            <span className="settings-row-desc">{'Give each model the editing tools it was trained on: Claude\'s text editor and persistent bash on the Anthropic API, apply_patch for GPT models. Undo, permissions and verification still apply.'}</span>
          </div>
          <Switch checked={nativeCodingTools} onCheckedChange={setNativeCodingTools} aria-label={'Model-native coding tools'} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Claude native computer tool'}</span>
            <span className="settings-row-desc">{'On the Anthropic API, give Claude its own trained computer tool (batched actions, best click accuracy). Pawn\'s accessibility, OCR, app and menu tools stay available.'}</span>
          </div>
          <Switch checked={nativeComputerTool} onCheckedChange={setNativeComputerTool} aria-label={'Claude native computer tool'} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Language server diagnostics'}</span>
            <span className="settings-row-desc">{'Run installed language servers (TypeScript, Python, Go, Rust) so the agent sees real errors right after each edit and can jump to definitions/references.'}</span>
          </div>
          <Switch checked={lspDiagnostics} onCheckedChange={setLspDiagnostics} aria-label={'Language server diagnostics'} />
        </div>
      </div>
    </div>
  )
}
