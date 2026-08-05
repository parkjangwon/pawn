import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoutineStore } from '../stores/routine'
import { useAppStore } from '../stores/app'
import ConfirmDialog from './ConfirmDialog'
import NavControls from './NavControls'
import './AutomationView.css'

type TriggerType = 'interval' | 'daily' | 'weekly'

interface AutomationViewProps {
  onToggleSidebar: () => void
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
}

interface DraftState {
  name: string
  trigger: TriggerType
  hour: string
  minute: string
  weekday: string
  intervalMin: string
  prompt: string
  projectId: string
}

export default function AutomationView({
  onToggleSidebar, canGoBack, canGoForward, onGoBack, onGoForward
}: AutomationViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { routines, add, toggle, remove, runNow, runningIds, refresh } = useRoutineStore()
  const { projects, activeProjectId } = useAppStore()
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDeleteRoutine, setConfirmDeleteRoutine] = useState<{ id: string; name: string } | null>(null)
  const [importMsg, setImportMsg] = useState('')
  const [draft, setDraft] = useState<DraftState>({
    name: '', trigger: 'daily', hour: '09', minute: '00', weekday: '1', intervalMin: '30', prompt: '', projectId: activeProjectId || ''
  })

  const userProjects = projects.filter((p) => p.id !== '__general__')
  const canCreate = draft.name.trim().length > 0 && draft.prompt.trim().length > 0

  const openCreate = (preset?: Partial<DraftState>): void => {
    setDraft({
      name: '', trigger: 'daily', hour: '09', minute: '00', weekday: '1', intervalMin: '30', prompt: '', projectId: activeProjectId || '',
      ...preset
    })
    setShowCreate(true)
  }

  useEffect(() => {
    if (!showCreate) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShowCreate(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showCreate])

  const triggerLabel = (scheduleJson: string, enabled: boolean): string => {
    if (!enabled) return t('automation.manual')
    try {
      const parsed = JSON.parse(scheduleJson) as { type: TriggerType }
      if (parsed.type === 'daily') return t('automation.daily')
      if (parsed.type === 'weekly') return t('automation.weekly')
      return t('automation.interval')
    } catch {
      return t('automation.manual')
    }
  }

  const scheduleDetail = (scheduleJson: string): string => {
    try {
      const s = JSON.parse(scheduleJson) as RoutineSchedule
      if (s.type === 'interval') return t('settings.automationSection.everyMinutes', { minutes: s.minutes })
      const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
      if (s.type === 'daily') return t('settings.automationSection.dailyAt', { time })
      return t('settings.automationSection.weeklyAt', { weekday: t(`settings.automationSection.weekdays.${s.weekday}`), time })
    } catch {
      return ''
    }
  }

  const formatRunTime = (ms: number): string => {
    if (!ms) return t('settings.automationSection.never')
    return new Date(ms).toLocaleString(i18n.language)
  }

  const createAutomation = async (): Promise<void> => {
    if (!canCreate) return
    const schedule =
      draft.trigger === 'interval'
        ? { type: 'interval' as const, minutes: Math.max(1, Number(draft.intervalMin) || 30) }
        : draft.trigger === 'daily'
          ? { type: 'daily' as const, hour: Number(draft.hour), minute: Number(draft.minute) }
          : { type: 'weekly' as const, weekday: Number(draft.weekday), hour: Number(draft.hour), minute: Number(draft.minute) }
    await add({ name: draft.name.trim(), prompt: draft.prompt.trim(), schedule, projectId: draft.projectId || undefined })
    setShowCreate(false)
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  const templates = useMemo(
    () => [
      { title: t('automation.examples.dailyReport'), desc: t('automation.examples.dailyReportDesc'), badge: t('automation.daily'), trigger: 'daily' as TriggerType, preset: { hour: '18', minute: '00' } },
      { title: t('automation.examples.webMonitor'), desc: t('automation.examples.webMonitorDesc'), badge: t('automation.interval'), trigger: 'interval' as TriggerType, preset: { intervalMin: '30' } },
      { title: t('automation.examples.rssDigest'), desc: t('automation.examples.rssDigestDesc'), badge: t('automation.daily'), trigger: 'daily' as TriggerType, preset: { hour: '07', minute: '00' } },
      { title: t('automation.examples.issueTriage'), desc: t('automation.examples.issueTriageDesc'), badge: t('automation.daily'), trigger: 'daily' as TriggerType, preset: { hour: '09', minute: '00' } },
      { title: t('automation.examples.changelog'), desc: t('automation.examples.changelogDesc'), badge: t('automation.weekly'), trigger: 'weekly' as TriggerType, preset: { hour: '10', minute: '00', weekday: '5' } },
      { title: t('automation.examples.repoAudit'), desc: t('automation.examples.repoAuditDesc'), badge: t('automation.manual'), trigger: 'daily' as TriggerType, preset: { hour: '12', minute: '00' } }
    ],
    [t]
  )

  const exportAutomations = async (): Promise<void> => {
    if (routines.length === 0) {
      setImportMsg(t('automation.exportEmpty'))
      return
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      routines: routines.map((r) => {
        let schedule: RoutineSchedule = { type: 'interval', minutes: 60 }
        try { schedule = JSON.parse(r.schedule) as RoutineSchedule } catch { /* keep fallback */ }
        return { name: r.name, prompt: r.prompt, schedule, projectId: r.projectId || undefined, sessionId: r.sessionId || undefined }
      })
    }
    const saved = await window.api.saveFile('pawn-automations.json', JSON.stringify(payload, null, 2))
    if (saved) setImportMsg(t('automation.exported'))
  }

  const importAutomations = async (): Promise<void> => {
    const raw = await window.api.openFile()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { routines?: Array<{ name?: string; prompt?: string; schedule?: RoutineSchedule; projectId?: string }> }
      const list = Array.isArray(parsed.routines) ? parsed.routines : []
      let added = 0
      for (const item of list) {
        if (!item || typeof item.name !== 'string' || typeof item.prompt !== 'string' || !item.schedule) continue
        await add({ name: item.name, prompt: item.prompt, schedule: item.schedule, projectId: item.projectId || undefined })
        added++
      }
      setImportMsg(added > 0 ? `${t('automation.imported')} (${added})` : t('automation.importEmpty'))
      await refresh()
    } catch {
      setImportMsg(t('automation.importFailed'))
    }
  }

  return (
    <main className="automation-page">
      <div className="chat-header">
        <button className="sidebar-toggle-btn close-sidebar-btn" onClick={onToggleSidebar} aria-label={t('contextBar.openSidebar')} title={t('contextBar.openSidebar')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
        <div className="chat-header-spacer" />
        <span className="automation-import-msg">{importMsg}</span>
        <button className="automation-tool-btn" onClick={() => void importAutomations()} title={t('automation.import')}>{t('automation.import')}</button>
        <button className="automation-tool-btn" onClick={() => void exportAutomations()} title={t('automation.export')}>{t('automation.export')}</button>
        <button className="btn-primary automation-header-btn" onClick={() => openCreate()}>{t('automation.new')}</button>
      </div>

      <section className="automation-content">
        <div className="automation-shell">
          <div className="automation-page-head">
            <h2>{t('automation.title')}</h2>
            <p className="settings-desc">{t('automation.listDesc')}</p>
          </div>

          {routines.length === 0 && (
            <div className="automation-hero">
              <div className="automation-hero-icon" aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="17" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  <path d="M8.5 14.5l2 2 4.5-4.5" />
                </svg>
              </div>
              <h3>{t('automation.emptyTitle')}</h3>
              <p>{t('automation.emptyDesc')}</p>
              <button className="btn-primary automation-cta" onClick={() => openCreate()}>{t('automation.start')}</button>
            </div>
          )}

          <div className="automation-templates">
            <div className="automation-page-head">
              <h3>{t('automation.templates.title')}</h3>
            </div>
            <div className="automation-grid">
              {templates.map((card) => (
                <article
                  key={card.title}
                  className="automation-card example"
                  role="button"
                  tabIndex={0}
                  onClick={() => openCreate({ name: card.title, prompt: card.desc, trigger: card.trigger, ...card.preset })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openCreate({ name: card.title, prompt: card.desc, trigger: card.trigger, ...card.preset })
                  }}
                >
                  <div className="automation-card-head">
                    <h4>{card.title}</h4>
                    <span className="settings-badge">{card.badge}</span>
                  </div>
                  <p className="automation-card-desc">{card.desc}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="automation-grid">
            {routines.map((routine) => (
              <article key={routine.id} className="automation-card">
                <div className="automation-card-head">
                  <h4>{routine.name}</h4>
                  <span className="settings-badge">{triggerLabel(routine.schedule, routine.enabled)}</span>
                </div>
                <p className="automation-card-desc">{routine.prompt}</p>
                <p className="automation-card-meta">
                  {scheduleDetail(routine.schedule)}
                  {' · '}{t('settings.automationSection.nextRun')} {formatRunTime(routine.nextRunAt)}
                  {runningIds.has(routine.id) && <span className="settings-badge automation-running-badge"> {t('settings.automationSection.running')}</span>}
                </p>
                <div className="automation-card-actions">
                  <button className="test-btn" disabled={runningIds.has(routine.id)} onClick={() => void runNow(routine.id)}>{t('automation.runNow')}</button>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={routine.enabled} onChange={(e) => void toggle(routine.id, e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                  <button className="delete-btn" onClick={() => setConfirmDeleteRoutine({ id: routine.id, name: routine.name })}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </article>
            ))}

          </div>
        </div>
      </section>

      {showCreate && (
        <div className="automation-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="automation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="automation-modal-head">
              <h3>{t('automation.new')}</h3>
              <button className="automation-close" onClick={() => setShowCreate(false)}>×</button>
            </div>

            <div className="automation-form">
              <div className="automation-field">
                <label>{t('automation.name')}</label>
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={t('automation.namePlaceholder')} />
              </div>

              <div className="automation-form-row">
                <div className="automation-field">
                  <label>{t('automation.trigger')}</label>
                  <select value={draft.trigger} onChange={(e) => setDraft((d) => ({ ...d, trigger: e.target.value as TriggerType }))}>
                    <option value="daily">{t('automation.daily')}</option>
                    <option value="weekly">{t('automation.weekly')}</option>
                    <option value="interval">{t('automation.interval')}</option>
                  </select>
                </div>
                {draft.trigger === 'weekly' && (
                  <div className="automation-field">
                    <label>{t('automation.weekday')}</label>
                    <select value={draft.weekday} onChange={(e) => setDraft((d) => ({ ...d, weekday: e.target.value }))}>
                      {[0, 1, 2, 3, 4, 5, 6].map((w) => <option key={w} value={w}>{t(`settings.automationSection.weekdays.${w}`)}</option>)}
                    </select>
                  </div>
                )}
                {draft.trigger === 'interval' ? (
                  <div className="automation-field">
                    <label>{t('automation.minutes')}</label>
                    <input type="number" min={1} value={draft.intervalMin} onChange={(e) => setDraft((d) => ({ ...d, intervalMin: e.target.value }))} />
                  </div>
                ) : (
                  <>
                    <div className="automation-field">
                      <label>{t('automation.hour')}</label>
                      <select value={draft.hour} onChange={(e) => setDraft((d) => ({ ...d, hour: e.target.value }))}>
                        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => <option key={h} value={h}>{h}:00</option>)}
                      </select>
                    </div>
                    <div className="automation-field">
                      <label>{t('automation.minute')}</label>
                      <select value={draft.minute} onChange={(e) => setDraft((d) => ({ ...d, minute: e.target.value }))}>
                        {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>:{m}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>

              <div className="automation-field">
                <label>{t('automation.project')}</label>
                <select value={draft.projectId} onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}>
                  <option value="">{t('automation.noProject')}</option>
                  {userProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="automation-field-hint">{t('automation.projectHint')}</span>
              </div>

              <div className="automation-field">
                <label>{t('automation.prompt')}</label>
                <textarea value={draft.prompt} onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))} rows={5} placeholder={t('automation.promptPlaceholder')} />
              </div>
            </div>

            <div className="automation-modal-actions">
              <span className="automation-modal-hint">{t('automation.footerHint')}</span>
              <div className="automation-modal-actions-buttons">
                <button className="btn-cancel" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
                <button className="btn-primary" onClick={() => void createAutomation()} disabled={!canCreate}>{t('common.save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteRoutine && (
        <ConfirmDialog
          title={`${confirmDeleteRoutine.name} ${t('common.delete')}`}
          message={t('confirmDialog.deleteAutomationConfirm')}
          confirmLabel={t('confirmDialog.confirm')}
          cancelLabel={t('confirmDialog.cancel')}
          onConfirm={() => { void remove(confirmDeleteRoutine.id); setConfirmDeleteRoutine(null) }}
          onCancel={() => setConfirmDeleteRoutine(null)}
        />
      )}
    </main>
  )
}
