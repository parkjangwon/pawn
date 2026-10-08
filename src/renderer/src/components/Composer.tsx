import { ultraWorkTriggerLength } from '../agent/ultraWork'
import './UltraWork.css'
import { useMemo, useRef, useState } from 'react'
import { tx } from '../i18n'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Disc,
  DollarSign,
  Folder,
  Info,
  Paperclip,
  Shield,
  Square,
  X
} from 'lucide-react'
import TriggerMenu, { type TriggerItem } from './TriggerMenu'
import GitSummaryChip from './GitSummaryChip'
import Tooltip from './Tooltip'
import { useProviderStore } from '../stores/provider'
import { useRecordingStore } from '../stores/recording'
import { previewVisionTarget } from '../agent/router'
import { useUsageStore, formatCost, formatTokens, type CacheDiagnostic } from '../stores/usage'
import { compactSessionNow, useChatStore } from '../stores/chat'
import { useAppStore } from '../stores/app'
import { openSettingsSection } from './settingsState'
import type { Project } from '../stores/app'
import {
  LARGE_PASTE_CHARS, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_BYTES,
  truncateText, type ChatAttachment
} from '../utils/attachments'

interface ComposerProps {
  activeSession: boolean
  activeSessionId: string | null
  input: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onSend: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  trigger: { type: '/' | '@' | '$'; start: number; query: string } | null
  triggerItems: TriggerItem[]
  menuIndex: number
  onMenuIndexChange: (i: number) => void
  filesLoading: boolean
  onSelect: (item: TriggerItem) => void
  projects: Project[]
  activeProject: Project | undefined
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  showProjectPicker: boolean
  setShowProjectPicker: (v: boolean) => void
  showPermPicker: boolean
  setShowPermPicker: (v: boolean) => void
  showModelPicker: boolean
  setShowModelPicker: (v: boolean) => void
  showUsagePopover: boolean
  setShowUsagePopover: (v: boolean) => void
  projectPickerRef: React.RefObject<HTMLDivElement | null>
  permPickerRef: React.RefObject<HTMLDivElement | null>
  modelPickerRef: React.RefObject<HTMLDivElement | null>
  usageRef: React.RefObject<HTMLDivElement | null>
  isStreaming: boolean
  onStop: () => void
  attachments: ChatAttachment[]
  onAddAttachment: (a: ChatAttachment) => void
  onRemoveAttachment: (id: string) => void
  /** While streaming in queue mode: send the draft immediately as a steer. */
  onSteer?: () => void
}

export default function Composer(props: ComposerProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    models, providers, activeModelId, setActiveModel, permissionMode, setPermissionMode,
    reasoningEffort, setReasoningEffort, routingMode, setRoutingMode,
    agentMode: globalAgentMode,
    setAgentMode,
    agentModeFor,
    doneGate,
    setDoneGate
  } = useProviderStore()
  const agentMode = props.activeSessionId
    ? agentModeFor(props.activeSessionId)
    : globalAgentMode
  const usageTotals = useUsageStore((s) => (props.activeSessionId ? s.bySession[props.activeSessionId] : undefined))
  const lastRoute = useUsageStore((s) => (props.activeSessionId ? s.lastRoute[props.activeSessionId] : undefined))
  const sessionDiags = useUsageStore((s) => (props.activeSessionId ? s.diagnostics[props.activeSessionId] : undefined))
  const contextMeter = useUsageStore((s) =>
    props.activeSessionId ? s.contextBySession[props.activeSessionId] : undefined
  )
  const [compacting, setCompacting] = useState(false)
  const currentModel = models.find((m) => m.id === activeModelId) || models.find((m) => m.enabled)
  const currentModelLabel = currentModel?.label || currentModel?.modelId || 'No model'
  // No provider configured: hint at Settings in the placeholder instead of a banner.
  const hasProvider = providers.some((p) => p.enabled)
  const composerPlaceholder = hasProvider ? 'Ask, build, or automate…' : 'Add a provider in Settings to get started'

  // Images attached for a model that cannot see them: say where they go.
  const visionNote = useMemo(() => {
    if (!props.attachments.some((a) => a.kind === 'image')) return null
    const target = routingMode === 'auto' ? undefined : currentModel
    const { sees, fallback } = previewVisionTarget(target)
    if (sees) return null
    if (routingMode === 'auto') return fallback ? null : 'No enabled model can see images — the image won\'t be read. Enable a vision model in Settings → Models.'
    const name = currentModel?.label || currentModel?.modelId || ''
    return fallback
      ? `${name} can't see images — this message goes to ${fallback.label || fallback.modelId} instead.`
      : `${name} can't see images, and no vision model is enabled — the image won't be read. Add or enable a vision model in Settings → Models.`
  }, [props.attachments, routingMode, currentModel])
  const permLabels: Record<string, string> = { ask: 'Ask', auto: 'Auto-approve', yolo: 'Full auto' }
  const permDescs: Record<string, string> = { ask: 'Ask me before it changes files or runs commands', auto: 'Do everyday actions on its own; ask for risky ones', yolo: 'Never ask — only for trusted work' }
  const reasoningLabels: Record<string, string> = {
    auto: 'Reasoning auto', low: 'Reasoning low',
    medium: 'Reasoning medium', high: 'Reasoning high'
  }
  const reasoningDescs: Record<string, string> = {
    auto: 'Pick automatically based on the task', low: 'Faster responses',
    medium: 'Balanced', high: 'Deeper thinking'
  }
  const triggerOpen = props.trigger !== null
  const { trigger, triggerItems, menuIndex, onMenuIndexChange, filesLoading, onSelect } = props
  const { input, onChange, onKeyDown, onSend, textareaRef, activeSession, projects, activeProject, activeProjectId, onSelectProject } = props
  const { showProjectPicker, setShowProjectPicker, showPermPicker, setShowPermPicker, showModelPicker, setShowModelPicker, showUsagePopover, setShowUsagePopover } = props
  const { projectPickerRef, permPickerRef, modelPickerRef, usageRef, isStreaming, onStop } = props
  const { attachments, onAddAttachment, onRemoveAttachment, onSteer } = props
  // Never let a composed message die in a "no provider" error: with zero
  // enabled providers the send is blocked and a fix-it chip is shown instead.
  const noProviders = providers.filter((p) => p.enabled).length === 0
  // Files the agent read or edited this chat — answers "what is in context"
  // without leaving the composer.
  const touchedFiles = useMemo(() => {
    if (!props.activeSessionId || !props.activeProjectId) return []
    const session = useAppStore
      .getState()
      .projects.find((p) => p.id === props.activeProjectId)
      ?.sessions.find((s) => s.id === props.activeSessionId)
    if (!session) return []
    const seen = new Set<string>()
    for (const m of session.messages) {
      const p = m.toolMeta?.path
      if (typeof p === 'string' && p) seen.add(p)
    }
    return [...seen].slice(-8)
  }, [props.activeSessionId, props.activeProjectId, showUsagePopover])

  const addFile = (file: File): void => {
    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_BYTES) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onAddAttachment({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name || 'Pasted image',
            kind: 'image',
            dataUrl: reader.result,
            bytes: file.size
          })
        }
      }
      reader.readAsDataURL(file)
      return
    }
    if (file.size <= MAX_TEXT_BYTES) {
      void file.text().then((content) => {
        onAddAttachment({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || 'Attached file',
          kind: 'text',
          content: truncateText(content).text,
          bytes: file.size
        })
      }).catch(() => {})
    }
  }

  const handlePaste = (e: React.ClipboardEvent): void => {
    const items = Array.from(e.clipboardData?.items || [])
    const images = items.filter((i) => i.type.startsWith('image/'))
    if (images.length > 0) {
      e.preventDefault()
      for (const item of images.slice(0, MAX_ATTACHMENTS)) {
        const file = item.getAsFile()
        if (file) addFile(file)
      }
      return
    }
    const text = e.clipboardData?.getData('text') || ''
    if (text.length > LARGE_PASTE_CHARS) {
      // Large pastes become a removable chip instead of flooding the input.
      e.preventDefault()
      onAddAttachment({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Pasted text',
        kind: 'text',
        content: truncateText(text).text,
        bytes: text.length
      })
    }
  }

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    for (const file of files.slice(0, MAX_ATTACHMENTS)) addFile(file)
    e.target.value = ''
  }

  // `$ulw` / `/ultra-work` at the start of the draft arms Ultra Work.
  const ulwArmed = ultraWorkTriggerLength(input) > 0
  const recordSupported = useRecordingStore((s) => s.supported)
  const recording = useRecordingStore((s) => s.status.state === 'recording')
  const recordSetupOpen = useRecordingStore((s) => s.setupOpen)

  return (
      <div className="chat-input-wrapper">
       <div className={`chat-input-container${ulwArmed ? ' ulw-armed' : ''}`} role="group" aria-label={composerPlaceholder}>
          <TriggerMenu
            open={triggerOpen}
            trigger={trigger?.type ?? null}
            items={triggerItems}
            selectedIndex={Math.min(menuIndex, Math.max(triggerItems.length - 1, 0))}
            loading={trigger?.type === '@' && filesLoading}
            emptyText={trigger?.type === '@' ? 'No matching files' : trigger?.type === '$' ? 'No matching gambits' : 'No matching commands'}
            title={trigger?.type === '@' ? 'Files & folders' : trigger?.type === '$' ? 'Gambits · keyword modes' : 'Commands'}
            onSelect={onSelect}
            onHover={onMenuIndexChange}
          />
          {/* Context chips bar — also on a blank new chat (when there are projects)
              so the user can pick where the chat goes before the first send. */}
          {(activeSession || projects.some((p) => p.id !== '__general__')) && (
            <div className="context-bar">
              <div className="context-chip-wrapper" ref={projectPickerRef}>
                <button
                  type="button"
                  className="context-chip project-chip"
                  aria-haspopup="dialog"
                  aria-expanded={showProjectPicker}
                  onClick={() => { setShowProjectPicker(!showProjectPicker); setShowPermPicker(false); setShowModelPicker(false); setShowUsagePopover(false) }}
                  title={'Switch project'}
                >
                  <Folder size={12} />
                  <span>{activeProject && activeProject.id !== '__general__' ? activeProject.name : 'Everyday work'}</span>
                  <ChevronDown size={8} />
                </button>
                {showProjectPicker && (
                  <div className="project-picker">
                    <div className="picker-list">
                      {projects.filter((p) => p.id !== '__general__').map((p) => (
                        <button
                          key={p.id}
                          className={`picker-item ${p.id === activeProjectId ? 'active' : ''}`}
                          onClick={() => onSelectProject(p.id)}
                        >
                          <Folder size={12} />
                          <span>{p.name}</span>
                          {p.paths?.[0] && <span className="picker-path">{p.paths[0].split('/').pop()}</span>}
                          {p.id === activeProjectId && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                    <div className="picker-footer">
                      <button className="picker-item" onClick={() => { onSelectProject('__general__') }}>
                        <X size={12} />
                        <span>{'Work without a project'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <GitSummaryChip
                projectPath={(() => {
                  const paths = activeProject?.paths || []
                  if (!paths.length) return ''
                  const session = activeProject?.sessions?.find(
                    (s) => s.id === props.activeSessionId
                  )
                  if (session?.path && paths.includes(session.path)) return session.path
                  return paths[0] || ''
                })()}
              />
            </div>
          )}

          {/* Text input */}
          <div className="chat-input-box">
            {ulwArmed && (
              <div className="ulw-input-hint" aria-live="polite">
                <span className="ulw-rainbow-text">{'ULTRA WORK'}</span>
                <span className="ulw-hint-text">{'Keeps working until the goal is verified done · Build + Maxing · Enter to start'}</span>
              </div>
            )}
            {visionNote && (
              <div className="attachment-vision-note" role="status">
                <Info size={12} aria-hidden />
                <span>{visionNote}</span>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="attachment-bar">
                {attachments.map((a) => (
                  <span key={a.id} className="attachment-chip" title={a.name}>
                    {a.kind === 'image' && a.dataUrl && (
                      <img className="attachment-chip-thumb" src={a.dataUrl} alt="" />
                    )}
                    <span className="attachment-chip-name">{a.name}</span>
                    <button
                      className="attachment-chip-x"
                      onClick={() => onRemoveAttachment(a.id)}
                      aria-label={'Remove attachment'}
                      title={'Remove attachment'}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onPaste={handlePaste}
              placeholder={composerPlaceholder}
              rows={1}
              aria-label={composerPlaceholder}
            />
            <div className="input-actions">
              {/* Left: permission mode */}
              <div className="input-actions-left">
                <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title={'Attach files'} aria-label={'Attach files'}>
                  <Paperclip size={15} />
                </button>
                {recordSupported && (
                  <button
                    type="button"
                    className={`attach-btn record-btn${recording ? ' recording' : ''}${recordSetupOpen ? ' active' : ''}`}
                    onClick={() => {
                      const rec = useRecordingStore.getState()
                      if (recording) void rec.stop()
                      else if (recordSetupOpen) rec.closeSetup()
                      else rec.openSetup({ projectId: activeProjectId ?? undefined, sessionId: props.activeSessionId ?? undefined })
                    }}
                    title={recording ? 'Stop recording' : 'Record a workflow'}
                    aria-label={recording ? 'Stop recording' : 'Record a workflow'}
                    aria-pressed={recording || recordSetupOpen}
                  >
                    {recording ? <Square size={15} /> : <Disc size={15} />}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFilesPicked}
                />
                <div className="mode-segment-pill" ref={permPickerRef}>
                  <button
                    type="button"
                    className={`mode-segment-btn agent-btn agent-${agentMode}`}
                    onClick={() =>
                      setAgentMode(
                        agentMode === 'plan' ? 'build' : 'plan',
                        props.activeSessionId
                      )
                    }
                    title={agentMode === 'plan' ? 'Plan: look around and propose a plan — nothing gets changed. Alt+P switches.' : 'Build: actually does the work (edits files, runs commands). Alt+P switches to Plan.'}
                    aria-label={agentMode === 'plan' ? 'Plan' : 'Build'}
                  >
                    {agentMode === 'plan' ? <ClipboardCheck size={11} /> : <ArrowUp size={11} />}
                    <span className="agent-label">{agentMode === 'plan' ? 'Plan' : 'Build'}</span>
                  </button>
                  <span className="mode-segment-sep" aria-hidden="true" />
                  <button
                    type="button"
                    className={`mode-segment-btn perm-btn perm-${permissionMode}`}
                    aria-haspopup="dialog"
                    aria-expanded={showPermPicker}
                    onClick={() => { setShowPermPicker(!showPermPicker); setShowProjectPicker(false); setShowModelPicker(false); setShowUsagePopover(false) }}
                    title={permLabels[permissionMode]}
                    aria-label={permLabels[permissionMode]}
                  >
                    <Shield size={11} />
                    <span className="perm-label">{permLabels[permissionMode]}</span>
                  </button>
                  {showPermPicker && (
                    <div className="project-picker perm-picker">
                      {(['ask', 'auto', 'yolo'] as const).map((mode) => (
                        <button key={mode} className={`picker-item ${permissionMode === mode ? 'active' : ''}`} onClick={() => { setPermissionMode(mode); setShowPermPicker(false) }}>
                          <span className="picker-item-label">{permLabels[mode]}</span>
                          <span className="picker-item-desc">{permDescs[mode]}</span>
                          {permissionMode === mode && <Check size={12} />}
                        </button>
                      ))}
                      {/* Checks after code edits: only meaningful in a code project. */}
                      {activeProject && activeProject.id !== '__general__' && (activeProject.paths?.length ?? 0) > 0 && (
                      <div className="picker-group">
                        <div className="picker-group-label">{'Done gate'}</div>
                        {([
                          { id: 'off' as const, label: 'Off', desc: 'Do not auto-run checks after edits' },
                          { id: 'typecheck' as const, label: 'Typecheck', desc: 'Auto typecheck after code edits (auto/yolo)' },
                          { id: 'test' as const, label: 'Test', desc: 'Auto test after code edits (auto/yolo)' }
                        ]).map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className={`picker-item ${doneGate === g.id ? 'active' : ''}`}
                            onClick={() => { setDoneGate(g.id); setShowPermPicker(false) }}
                          >
                            <span className="picker-item-label">{g.label}</span>
                            <span className="picker-item-desc">{g.desc}</span>
                            {doneGate === g.id && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: model + send */}
              <div className="input-actions-right">
                {((usageTotals && usageTotals.calls > 0) || contextMeter) && (
                  <div className="context-chip-wrapper" ref={usageRef}>
                    <button
                      type="button"
                      className="context-chip usage-chip"
                      aria-haspopup="dialog"
                      aria-expanded={showUsagePopover}
                      onClick={() => { setShowUsagePopover(!showUsagePopover); setShowProjectPicker(false); setShowPermPicker(false); setShowModelPicker(false) }}
                      title={lastRoute ? `${lastRoute.label} — ${lastRoute.reason}` : 'Usage in this chat'}
                      aria-label={'Usage in this chat'}
                    >
                      <DollarSign size={12} />
                      {usageTotals && usageTotals.calls > 0 && (
                        <span>{formatCost(usageTotals.cost)}</span>
                      )}
                      {contextMeter && (
                        <span
                          className={`usage-chip-ctx ${contextMeter.ratio >= 0.6 ? 'warn' : ''} ${contextMeter.ratio >= 0.85 ? 'hot' : ''}`}
                          title={`${Math.round(contextMeter.ratio * 100)}% context (${formatTokens(contextMeter.tokens)} / ${formatTokens(contextMeter.window)})`}
                        >
                          {usageTotals && usageTotals.calls > 0 ? '· ' : ''}
                          {Math.round(contextMeter.ratio * 100)}%
                        </span>
                      )}
                      {usageTotals && usageTotals.cacheHitRate > 0.01 && (
                        <span className="usage-chip-cache">· {Math.round(usageTotals.cacheHitRate * 100)}% {'cached'}</span>
                      )}
                    </button>
                    {showUsagePopover && (
                      <div className="project-picker usage-popover">
                        <div className="picker-item-label">{'Usage in this chat'}</div>
                        {contextMeter && (
                          <>
                            <div className="usage-popover-row">
                              <span>{'Context window'}</span>
                              <span>
                                {formatTokens(contextMeter.tokens)} / {formatTokens(contextMeter.window)}
                              </span>
                            </div>
                            <div className="usage-context-bar" aria-hidden="true">
                              <div
                                className={`usage-context-fill ${contextMeter.ratio >= 0.6 ? 'warn' : ''} ${contextMeter.ratio >= 0.85 ? 'hot' : ''}`}
                                style={{ width: `${Math.min(100, Math.round(contextMeter.ratio * 100))}%` }}
                              />
                            </div>
                            {contextMeter.compacted && (
                              <div className="usage-popover-route">{'Transcript was compacted to free space'}</div>
                            )}
                          </>
                        )}
                        {usageTotals && usageTotals.calls > 0 && (
                          <>
                            <div className="usage-popover-row"><span>{'Input'}</span><span>{formatTokens(usageTotals.inputTokens)}</span></div>
                            <div className="usage-popover-row"><span>{'Output'}</span><span>{formatTokens(usageTotals.outputTokens)}</span></div>
                            <div className="usage-popover-row"><span>{'Cache read'}</span><span>{formatTokens(usageTotals.cacheReadTokens)}</span></div>
                            <div className="usage-popover-row"><span>{'Cache write'}</span><span>{formatTokens(usageTotals.cacheWriteTokens)}</span></div>
                            <div className="usage-popover-row"><span>{'Cache hit rate'}</span><span>{Math.round(usageTotals.cacheHitRate * 100)}%</span></div>
                            <div className="usage-popover-row total"><span>{'Total cost'}</span><span>{formatCost(usageTotals.cost)}</span></div>
                            {usageTotals.savedCost > 0 && (
                              <div className="usage-popover-row saved"><span>{'Saved by cache'}</span><span>{formatCost(usageTotals.savedCost)}</span></div>
                            )}
                          </>
                        )}
                        {lastRoute && <div className="usage-popover-route">{lastRoute.label} — {lastRoute.reason}</div>}
                        {touchedFiles.length > 0 && (
                          <div className="usage-files">
                            <div className="picker-item-label">{'Files in this chat'}</div>
                            {touchedFiles.map((f) => (
                              <div key={f} className="usage-popover-route usage-file-row" title={f}>
                                {f.replace(/^\/Users\/[^/]+/, '~')}
                              </div>
                            ))}
                          </div>
                        )}
                        {props.activeSessionId && (
                          <button
                            type="button"
                            className="usage-compact-btn"
                            disabled={compacting || isStreaming}
                            onClick={() => {
                              if (!props.activeSessionId) return
                              setCompacting(true)
                              void compactSessionNow(props.activeSessionId).finally(() => setCompacting(false))
                            }}
                          >
                            {compacting ? 'Compacting…' : 'Compact context now'}
                          </button>
                        )}
                        {props.activeSessionId && props.activeProjectId && (
                          <button
                            type="button"
                            className="usage-compact-btn"
                            title={'Start a new chat seeded with a summary of this one — fresh context, same goal.'}
                            onClick={() => {
                              if (!props.activeSessionId || !props.activeProjectId) return
                              useChatStore.getState().handoffToNewSession(props.activeProjectId, props.activeSessionId)
                              setShowUsagePopover(false)
                            }}
                          >
                            {'Continue in a fresh chat'}
                          </button>
                        )}
                        {sessionDiags && sessionDiags.length > 0 && (
                          <div className="usage-diagnostics">
                            {sessionDiags.slice(-4).map((d: CacheDiagnostic, i: number) => (
                              <div key={i} className={`usage-diagnostic ${d.level}`}>
                                <span className="diagnostic-icon">{d.level === 'warn' ? '⚠' : '✓'}</span>
                                <span>{d.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                     </div>
                    )}
                  </div>
                )}
                <div className="context-chip-wrapper" ref={modelPickerRef}>
                  <button
                    type="button"
                    className="context-chip model-chip-btn"
                    aria-haspopup="dialog"
                    aria-expanded={showModelPicker}
                    onClick={() => { setShowModelPicker(!showModelPicker); setShowProjectPicker(false); setShowPermPicker(false); setShowUsagePopover(false) }}
                    title={routingMode === 'auto' ? (lastRoute ? `${'Auto'} · ${lastRoute.label}` : 'Auto') : currentModelLabel}
                    aria-label={`${'Model'}: ${routingMode === 'auto' ? (lastRoute ? `${'Auto'} · ${lastRoute.label}` : 'Auto') : currentModelLabel}`}
                  >
                    <Clock size={12} />
                    <span>{routingMode === 'auto'
                      ? (lastRoute ? `${'Auto'} · ${lastRoute.label}` : 'Auto')
                      : currentModelLabel}</span>
                    <ChevronDown size={8} />
                  </button>
                  {showModelPicker && (
                    <div className="project-picker model-picker">
                      <button className={`picker-item ${routingMode === 'auto' ? 'active' : ''}`} onClick={() => { setActiveModel(null); setRoutingMode('auto'); setShowModelPicker(false) }}>
                        <span className="picker-item-label">{'Auto'}</span>
                        <span className="picker-item-desc">{'Pick the model automatically based on the task'}</span>
                        {routingMode === 'auto' && <Check size={12} />}
                      </button>
                      {providers.filter((p) => p.enabled).map((provider) => (
                        <div key={provider.id} className="picker-group">
                          <div className="picker-group-label">{provider.name}</div>
                          {models.filter((m) => m.providerId === provider.id && m.enabled).map((m) => (
                            <button key={m.id} className={`picker-item ${m.id === activeModelId ? 'active' : ''}`} onClick={() => { setActiveModel(m.id); setShowModelPicker(false) }}>
                              <span>{m.label || m.modelId}</span>
                              {m.id === activeModelId && <Check size={12} />}
                            </button>
                          ))}
                        </div>
                      ))}
                      {models.filter((m) => m.enabled).length === 0 && (
                        <div className="picker-empty">{'No models available'}</div>
                      )}
                      <div className="picker-group">
                        <div className="picker-group-label">{'Reasoning'}</div>
                        {(['auto', 'low', 'medium', 'high'] as const).map((e) => (
                          <button key={e} className={`picker-item ${reasoningEffort === e ? 'active' : ''}`} onClick={() => { setReasoningEffort(e); setShowModelPicker(false) }}>
                            <span className="picker-item-label">{reasoningLabels[e]}</span>
                            <span className="picker-item-desc">{reasoningDescs[e]}</span>
                            {reasoningEffort === e && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {isStreaming ? (
                  <>
                    {onSteer && (
                      <button
                        type="button"
                        className="steer-btn"
                        onClick={onSteer}
                        disabled={noProviders || (!input.trim() && attachments.length === 0)}
                        title={'Interrupt and steer with a new message'}
                        aria-label={'Steer'}
                      >
                        <ArrowUp size={12} />
                        <span>{'Steer'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="stop-btn"
                      onClick={onStop}
                      title={'Stop'}
                      aria-label={'Stop'}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                  </>
                ) : (
                  <>
                    {noProviders && (
                      <div className="composer-need-provider">
                        <span>{'Add an AI provider to start'}</span>
                        <button
                          type="button"
                          className="composer-add-provider"
                          onClick={() => openSettingsSection('providers')}
                        >
                          {'Add provider'}
                        </button>
                      </div>
                    )}
                    <Tooltip label={'Send'} shortcut={'Enter'} placement="top">
                      <button
                        type="button"
                        className="send-btn"
                        onClick={() => onSend()}
                        disabled={noProviders || (!input.trim() && attachments.length === 0)}
                        aria-label={'Send'}
                      >
                        <ArrowUp size={16} />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
