import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TriggerMenu, { type TriggerItem } from './TriggerMenu'
import GitSummaryChip from './GitSummaryChip'
import { useProviderStore } from '../stores/provider'
import { useUsageStore, formatCost, formatTokens, type CacheDiagnostic } from '../stores/usage'
import { compactSessionNow } from '../stores/chat'
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
  trigger: { type: '/' | '@'; start: number; query: string } | null
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
  sendMode?: 'queue' | 'steer'
  onSendModeChange?: (mode: 'queue' | 'steer') => void
  queueLength?: number
}

export default function Composer(props: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    models, providers, activeModelId, setActiveModel, permissionMode, setPermissionMode,
    reasoningEffort, setReasoningEffort, routingMode, setRoutingMode,
    agentMode, setAgentMode, doneGate, setDoneGate
  } = useProviderStore()
  const usageTotals = useUsageStore((s) => (props.activeSessionId ? s.bySession[props.activeSessionId] : undefined))
  const lastRoute = useUsageStore((s) => (props.activeSessionId ? s.lastRoute[props.activeSessionId] : undefined))
  const sessionDiags = useUsageStore((s) => (props.activeSessionId ? s.diagnostics[props.activeSessionId] : undefined))
  const contextMeter = useUsageStore((s) =>
    props.activeSessionId ? s.contextBySession[props.activeSessionId] : undefined
  )
  const [compacting, setCompacting] = useState(false)
  const currentModel = models.find((m) => m.id === activeModelId) || models.find((m) => m.enabled)
  const currentModelLabel = currentModel?.label || currentModel?.modelId || t('modelPicker.noModel')
  const permLabels: Record<string, string> = { ask: t('permission.ask'), auto: t('permission.auto'), yolo: t('permission.yolo') }
  const permDescs: Record<string, string> = { ask: t('permission.askDesc'), auto: t('permission.autoDesc'), yolo: t('permission.yoloDesc') }
  const reasoningLabels: Record<string, string> = {
    auto: t('modelPicker.reasoningAuto'), low: t('modelPicker.reasoningLow'),
    medium: t('modelPicker.reasoningMedium'), high: t('modelPicker.reasoningHigh')
  }
  const reasoningDescs: Record<string, string> = {
    auto: t('modelPicker.reasoningAutoDesc'), low: t('modelPicker.reasoningLowDesc'),
    medium: t('modelPicker.reasoningMediumDesc'), high: t('modelPicker.reasoningHighDesc')
  }
  const triggerOpen = props.trigger !== null
  const { trigger, triggerItems, menuIndex, onMenuIndexChange, filesLoading, onSelect } = props
  const { input, onChange, onKeyDown, onSend, textareaRef, activeSession, projects, activeProject, activeProjectId, onSelectProject } = props
  const { showProjectPicker, setShowProjectPicker, showPermPicker, setShowPermPicker, showModelPicker, setShowModelPicker, showUsagePopover, setShowUsagePopover } = props
  const { projectPickerRef, permPickerRef, modelPickerRef, usageRef, isStreaming, onStop } = props
  const { attachments, onAddAttachment, onRemoveAttachment, sendMode = 'queue', onSendModeChange, queueLength = 0 } = props

  const addFile = (file: File): void => {
    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_BYTES) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onAddAttachment({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name || t('chat.attachedImage'),
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
          name: file.name || t('chat.attachedText'),
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
        name: t('chat.pastedText'),
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

  return (
      <div className="chat-input-wrapper">
       <div className="chat-input-container" role="group" aria-label={t('chat.placeholder')}>
          <TriggerMenu
            open={triggerOpen}
            trigger={trigger?.type ?? null}
            items={triggerItems}
            selectedIndex={Math.min(menuIndex, Math.max(triggerItems.length - 1, 0))}
            loading={trigger?.type === '@' && filesLoading}
            emptyText={trigger?.type === '@' ? t('chat.mention.noResults') : t('chat.slash.noResults')}
            title={trigger?.type === '@' ? t('chat.mention.title') : t('chat.slash.title')}
            onSelect={onSelect}
            onHover={onMenuIndexChange}
          />
          {/* Context chips bar */}
          {activeSession && (
            <div className="context-bar">
              <div className="context-chip-wrapper" ref={projectPickerRef}>
                <button className="context-chip project-chip" onClick={() => { setShowProjectPicker(!showProjectPicker); setShowPermPicker(false); setShowModelPicker(false); setShowUsagePopover(false) }} title={t('contextBar.switchProject')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  <span>{activeProject?.name || t('contextBar.noProject')}</span>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
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
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                          <span>{p.name}</span>
                          {p.paths?.[0] && <span className="picker-path">{p.paths[0].split('/').pop()}</span>}
                          {p.id === activeProjectId && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                        </button>
                      ))}
                    </div>
                    <div className="picker-footer">
                      <button className="picker-item" onClick={() => { onSelectProject('__general__') }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        <span>{t('contextBar.workWithoutProject')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <GitSummaryChip projectPath={activeProject?.paths?.[0] || ''} />
            </div>
          )}

          {/* Text input */}
          <div className="chat-input-box">
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
                      aria-label={t('chat.removeAttachment')}
                      title={t('chat.removeAttachment')}
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
              placeholder={t('chat.placeholder')}
              rows={1}
              aria-label={t('chat.placeholder')}
            />
            <div className="input-actions">
              {/* Left: permission mode */}
              <div className="input-actions-left">
                <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title={t('chat.attach')} aria-label={t('chat.attach')}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFilesPicked}
                />
                <div className="context-chip-wrapper" ref={permPickerRef}>

                {onSendModeChange && (
                  <button
                    className={`perm-chip perm-send-${sendMode}`}
                    onClick={() => onSendModeChange(sendMode === 'queue' ? 'steer' : 'queue')}
                    title={sendMode === 'queue' ? t('contextBar.sendQueueHint') : t('contextBar.sendSteerHint')}
                  >
                    <span>{sendMode === 'queue' ? t('contextBar.sendQueue') : t('contextBar.sendSteer')}</span>
                    {queueLength > 0 && sendMode === 'queue' && (
                      <span className="usage-chip-cache">· {queueLength}</span>
                    )}
                  </button>
                )}
                  <button
                    type="button"
                    className={`perm-chip perm-agent-${agentMode}`}
                    onClick={() => setAgentMode(agentMode === 'plan' ? 'build' : 'plan')}
                    title={agentMode === 'plan' ? t('contextBar.agentPlanHint') : t('contextBar.agentBuildHint')}
                    aria-label={agentMode === 'plan' ? t('contextBar.agentPlan') : t('contextBar.agentBuild')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      {agentMode === 'plan' ? (
                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4" />
                      ) : (
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      )}
                    </svg>
                    <span>{agentMode === 'plan' ? t('contextBar.agentPlan') : t('contextBar.agentBuild')}</span>
                  </button>
                  <button className={`perm-chip perm-${permissionMode}`} onClick={() => { setShowPermPicker(!showPermPicker); setShowProjectPicker(false); setShowModelPicker(false); setShowUsagePopover(false) }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    <span>{permLabels[permissionMode]}</span>
                  </button>
                  {showPermPicker && (
                    <div className="project-picker perm-picker">
                      {(['ask', 'auto', 'yolo'] as const).map((mode) => (
                        <button key={mode} className={`picker-item ${permissionMode === mode ? 'active' : ''}`} onClick={() => { setPermissionMode(mode); setShowPermPicker(false) }}>
                          <span className="picker-item-label">{permLabels[mode]}</span>
                          <span className="picker-item-desc">{permDescs[mode]}</span>
                          {permissionMode === mode && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                        </button>
                      ))}
                      <div className="picker-group">
                        <div className="picker-group-label">{t('contextBar.doneGateLabel')}</div>
                        {([
                          { id: 'off' as const, label: t('contextBar.doneGateOff'), desc: t('contextBar.doneGateOffDesc') },
                          { id: 'typecheck' as const, label: t('contextBar.doneGateTypecheck'), desc: t('contextBar.doneGateTypecheckDesc') },
                          { id: 'test' as const, label: t('contextBar.doneGateTest'), desc: t('contextBar.doneGateTestDesc') }
                        ]).map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className={`picker-item ${doneGate === g.id ? 'active' : ''}`}
                            onClick={() => { setDoneGate(g.id); setShowPermPicker(false) }}
                          >
                            <span className="picker-item-label">{g.label}</span>
                            <span className="picker-item-desc">{g.desc}</span>
                            {doneGate === g.id && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: model + send */}
              <div className="input-actions-right">
                {((usageTotals && usageTotals.calls > 0) || contextMeter) && (
                  <div className="context-chip-wrapper" ref={usageRef}>
                    <button
                      className="context-chip usage-chip"
                      onClick={() => { setShowUsagePopover(!showUsagePopover); setShowProjectPicker(false); setShowPermPicker(false); setShowModelPicker(false) }}
                      title={lastRoute ? `${lastRoute.label} — ${lastRoute.reason}` : undefined}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      {usageTotals && usageTotals.calls > 0 && (
                        <span>{formatCost(usageTotals.cost)}</span>
                      )}
                      {contextMeter && (
                        <span
                          className={`usage-chip-ctx ${contextMeter.ratio >= 0.6 ? 'warn' : ''} ${contextMeter.ratio >= 0.85 ? 'hot' : ''}`}
                          title={t('contextBar.contextFill', {
                            pct: Math.round(contextMeter.ratio * 100),
                            used: formatTokens(contextMeter.tokens),
                            total: formatTokens(contextMeter.window)
                          })}
                        >
                          {usageTotals && usageTotals.calls > 0 ? '· ' : ''}
                          {Math.round(contextMeter.ratio * 100)}%
                        </span>
                      )}
                      {usageTotals && usageTotals.cacheHitRate > 0.01 && (
                        <span className="usage-chip-cache">· {Math.round(usageTotals.cacheHitRate * 100)}% {t('contextBar.cached')}</span>
                      )}
                    </button>
                    {showUsagePopover && (
                      <div className="project-picker usage-popover">
                        <div className="picker-item-label">{t('contextBar.usageTitle')}</div>
                        {contextMeter && (
                          <>
                            <div className="usage-popover-row">
                              <span>{t('contextBar.contextWindow')}</span>
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
                              <div className="usage-popover-route">{t('contextBar.contextCompacted')}</div>
                            )}
                          </>
                        )}
                        {usageTotals && usageTotals.calls > 0 && (
                          <>
                            <div className="usage-popover-row"><span>{t('contextBar.usageInput')}</span><span>{formatTokens(usageTotals.inputTokens)}</span></div>
                            <div className="usage-popover-row"><span>{t('contextBar.usageOutput')}</span><span>{formatTokens(usageTotals.outputTokens)}</span></div>
                            <div className="usage-popover-row"><span>{t('contextBar.usageCacheRead')}</span><span>{formatTokens(usageTotals.cacheReadTokens)}</span></div>
                            <div className="usage-popover-row"><span>{t('contextBar.usageCacheWrite')}</span><span>{formatTokens(usageTotals.cacheWriteTokens)}</span></div>
                            <div className="usage-popover-row"><span>{t('contextBar.usageCacheHitRate')}</span><span>{Math.round(usageTotals.cacheHitRate * 100)}%</span></div>
                            <div className="usage-popover-row total"><span>{t('contextBar.usageTotalCost')}</span><span>{formatCost(usageTotals.cost)}</span></div>
                            {usageTotals.savedCost > 0 && (
                              <div className="usage-popover-row saved"><span>{t('contextBar.usageSaved')}</span><span>{formatCost(usageTotals.savedCost)}</span></div>
                            )}
                          </>
                        )}
                        {lastRoute && <div className="usage-popover-route">{lastRoute.label} — {lastRoute.reason}</div>}
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
                            {compacting ? t('contextBar.compacting') : t('contextBar.compactNow')}
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
                  <button className="context-chip model-chip-btn" onClick={() => { setShowModelPicker(!showModelPicker); setShowProjectPicker(false); setShowPermPicker(false); setShowUsagePopover(false) }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                    <span>{routingMode === 'auto'
                      ? (lastRoute ? `${t('modelPicker.autoLabel')} · ${lastRoute.label}` : t('modelPicker.autoLabel'))
                      : currentModelLabel}</span>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  {showModelPicker && (
                    <div className="project-picker model-picker">
                      <button className={`picker-item ${routingMode === 'auto' ? 'active' : ''}`} onClick={() => { setActiveModel(null); setRoutingMode('auto'); setShowModelPicker(false) }}>
                        <span className="picker-item-label">{t('modelPicker.autoLabel')}</span>
                        <span className="picker-item-desc">{t('modelPicker.autoDesc')}</span>
                        {routingMode === 'auto' && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                      </button>
                      {providers.filter((p) => p.enabled).map((provider) => (
                        <div key={provider.id} className="picker-group">
                          <div className="picker-group-label">{provider.name}</div>
                          {models.filter((m) => m.providerId === provider.id && m.enabled).map((m) => (
                            <button key={m.id} className={`picker-item ${m.id === activeModelId ? 'active' : ''}`} onClick={() => { setActiveModel(m.id); setShowModelPicker(false) }}>
                              <span>{m.label || m.modelId}</span>
                              {m.id === activeModelId && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                            </button>
                          ))}
                        </div>
                      ))}
                      {models.filter((m) => m.enabled).length === 0 && (
                        <div className="picker-empty">{t('modelPicker.noModels')}</div>
                      )}
                      <div className="picker-group">
                        <div className="picker-group-label">{t('modelPicker.reasoningLabel')}</div>
                        {(['auto', 'low', 'medium', 'high'] as const).map((e) => (
                          <button key={e} className={`picker-item ${reasoningEffort === e ? 'active' : ''}`} onClick={() => { setReasoningEffort(e); setShowModelPicker(false) }}>
                            <span className="picker-item-label">{reasoningLabels[e]}</span>
                            <span className="picker-item-desc">{reasoningDescs[e]}</span>
                            {reasoningEffort === e && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {isStreaming ? (
                  <button className="stop-btn" onClick={onStop} title={t('chat.stop')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                  </button>
                ) : (
                  <button className="send-btn" onClick={onSend} disabled={!input.trim() && attachments.length === 0}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
