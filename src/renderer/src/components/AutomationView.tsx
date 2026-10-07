import { useEffect, useMemo, useRef, useState } from 'react'
import { tx } from '../i18n'
import { CalendarCheck, PanelLeft, Trash2 } from 'lucide-react'
import { useRoutineStore } from '../stores/routine'
import { useAutomationDraftStore } from '../stores/automationDraft'
import { formatDateTime } from '../utils/messageTime'
import { useAppStore } from '../stores/app'
import { useKeybindingsStore, formatCombo } from '../stores/keybindings'
import { activateOnKey, useFocusTrap } from '../utils/focusTrap'
import ConfirmDialog from './ConfirmDialog'
import NavControls from './NavControls'
import Tooltip from './Tooltip'
import Button from './Button'
import Input, { Textarea } from './Input'
import Select from './Select'
import Switch from './Switch'
// Cards reuse Settings controls (toggle, badges, buttons); Settings is lazy,
// so without this they render unstyled until Settings is opened once.
import './Settings.css'
import './AutomationView.css'

/** 'weekdays' is a UI trigger: saved as cron `M H * * 1-5`, recognized back on edit. */
type TriggerType = 'interval' | 'daily' | 'weekdays' | 'weekly' | 'cron' | 'file_watch'

const WEEKDAYS_CRON = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/

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
  cronExpr: string
  watchPath: string
  debounceMin: string
  stepsText: string
  maxRetries: string
  retryDelaySec: string
  prompt: string
  projectId: string
}

export default function AutomationView({
  onToggleSidebar, canGoBack, canGoForward, onGoBack, onGoForward
}: AutomationViewProps): React.JSX.Element {
  const { routines, add, update, toggle, remove, runNow, runningIds, refresh } = useRoutineStore()
  const { projects, activeProjectId } = useAppStore()
  const [showEditor, setShowEditor] = useState(false)
  const automationDialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(showEditor, automationDialogRef)
  /** null = create mode; string id = edit mode */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteRoutine, setConfirmDeleteRoutine] = useState<{ id: string; name: string } | null>(null)
  const [importMsg, setImportMsg] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const emptyDraft = (): DraftState => ({
    name: '',
    trigger: 'daily',
    hour: '09',
    minute: '00',
    weekday: '1',
    intervalMin: '30',
    cronExpr: '0 9 * * 1-5',
    watchPath: '',
    debounceMin: '1',
    stepsText: '',
    maxRetries: '0',
    retryDelaySec: '60',
    prompt: '',
    projectId: activeProjectId || ''
  })

  const [draft, setDraft] = useState<DraftState>(emptyDraft)

  const userProjects = projects.filter((p) => p.id !== '__general__')
  const canSave =
    draft.name.trim().length > 0 &&
    (draft.prompt.trim().length > 0 || draft.stepsText.trim().length > 0) &&
    (draft.trigger !== 'cron' || draft.cronExpr.trim().split(/\s+/).length === 5) &&
    (draft.trigger !== 'file_watch' || draft.watchPath.trim().length > 0)

  const closeEditor = (): void => {
    setShowEditor(false)
    setEditingId(null)
    setSaveError(null)
  }

  const openCreate = (preset?: Partial<DraftState>): void => {
    setEditingId(null)
    setSaveError(null)
    setDraft({ ...emptyDraft(), projectId: activeProjectId || '', ...preset })
    setShowEditor(true)
  }

  const openEdit = (routine: Routine): void => {
    setEditingId(routine.id)
    setSaveError(null)
    const d = emptyDraft()
    d.name = routine.name
    d.prompt = routine.prompt
    d.projectId = routine.projectId || ''
    try {
      const parsed = JSON.parse(routine.schedule) as RoutineSchedule & {
        maxRetries?: number
        retryDelaySec?: number
        steps?: string[]
      }
      d.trigger = parsed.type
      if (parsed.type === 'interval') d.intervalMin = String(parsed.minutes ?? 30)
      if (parsed.type === 'daily' || parsed.type === 'weekly') {
        d.hour = String(parsed.hour ?? 9).padStart(2, '0')
        d.minute = String(parsed.minute ?? 0).padStart(2, '0')
      }
      if (parsed.type === 'weekly') d.weekday = String(parsed.weekday ?? 1)
      if (parsed.type === 'cron') {
        d.cronExpr = parsed.expr || d.cronExpr
        const wd = WEEKDAYS_CRON.exec(d.cronExpr.trim())
        if (wd) {
          d.trigger = 'weekdays'
          d.minute = wd[1].padStart(2, '0')
          d.hour = wd[2].padStart(2, '0')
        }
      }
      if (parsed.type === 'file_watch') {
        d.watchPath = parsed.path || ''
        d.debounceMin = String(parsed.debounceMinutes ?? 1)
      }
      if (parsed.maxRetries != null) d.maxRetries = String(parsed.maxRetries)
      if (parsed.retryDelaySec != null) d.retryDelaySec = String(parsed.retryDelaySec)
      if (Array.isArray(parsed.steps) && parsed.steps.length) {
        d.stepsText = parsed.steps.join('\n')
      }
    } catch {
      /* keep defaults for schedule fields */
    }
    setDraft(d)
    setShowEditor(true)
  }

  useEffect(() => {
    if (!showEditor) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeEditor()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showEditor])

  const triggerLabel = (scheduleJson: string, enabled: boolean): string => {
    if (!enabled) return 'Manual'
    try {
      const parsed = JSON.parse(scheduleJson) as { type: TriggerType; expr?: string }
      if (parsed.type === 'daily') return 'Daily'
      if (parsed.type === 'weekly') return 'Weekly'
      if (parsed.type === 'cron') return WEEKDAYS_CRON.test((parsed.expr || '').trim()) ? 'Every weekday' : 'Custom (cron)'
      if (parsed.type === 'file_watch') return 'When a file changes'
      return 'Interval'
    } catch {
      return 'Manual'
    }
  }

  const scheduleDetail = (scheduleJson: string): string => {
    try {
      const s = JSON.parse(scheduleJson) as RoutineSchedule
      if (s.type === 'interval') return `Every ${s.minutes} min`
      if (s.type === 'cron') {
        const wd = WEEKDAYS_CRON.exec((s.expr || '').trim())
        if (wd) return `Weekdays at ${`${wd[2].padStart(2, '0')}:${wd[1].padStart(2, '0')}`}`
        return `cron: ${s.expr}`
      }
      if (s.type === 'file_watch') return `When ${s.path} changes`
      if (s.type === 'daily') {
        const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
        return `Daily at ${time}`
      }
      if (s.type === 'weekly') {
        const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
        return `Weekly ${tx(`settings.automationSection.weekdays.${s.weekday}`)} at ${time}`
      }
      return ''
    } catch {
      return ''
    }
  }

  const formatRunTime = (ms: number): string => {
    if (!ms) return 'Never'
    return formatDateTime(ms, 'en')
  }

  const buildSchedulePayload = (): RoutineSchedule & {
    maxRetries: number
    retryDelaySec: number
    steps?: string[]
  } => {
    let base: RoutineSchedule
    if (draft.trigger === 'interval') {
      base = { type: 'interval', minutes: Math.max(1, Number(draft.intervalMin) || 30) }
    } else if (draft.trigger === 'daily') {
      base = { type: 'daily', hour: Number(draft.hour), minute: Number(draft.minute) }
    } else if (draft.trigger === 'weekly') {
      base = {
        type: 'weekly',
        weekday: Number(draft.weekday),
        hour: Number(draft.hour),
        minute: Number(draft.minute)
      }
    } else if (draft.trigger === 'weekdays') {
      base = { type: 'cron', expr: `${Number(draft.minute)} ${Number(draft.hour)} * * 1-5` }
    } else if (draft.trigger === 'cron') {
      base = { type: 'cron', expr: draft.cronExpr.trim() }
    } else {
      base = {
        type: 'file_watch',
        path: draft.watchPath.trim(),
        debounceMinutes: Math.max(1, Number(draft.debounceMin) || 1)
      }
    }
    const steps = draft.stepsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20)
    return {
      ...base,
      maxRetries: Math.min(5, Math.max(0, Math.floor(Number(draft.maxRetries) || 0))),
      retryDelaySec: Math.min(3600, Math.max(10, Math.floor(Number(draft.retryDelaySec) || 60))),
      ...(steps.length ? { steps } : {})
    }
  }

  const saveAutomation = async (): Promise<void> => {
    if (!canSave) return
    setSaveError(null)
    const schedulePayload = buildSchedulePayload()
    const steps = schedulePayload.steps || []
    const prompt =
      draft.prompt.trim() ||
      (steps[0] ? steps[0] : 'Run automation steps.')
    try {
      if (editingId) {
        await update(editingId, {
          name: draft.name.trim(),
          prompt,
          schedule: schedulePayload as RoutineSchedule,
          projectId: draft.projectId || ''
        })
      } else {
        await add({
          name: draft.name.trim(),
          prompt,
          schedule: schedulePayload as RoutineSchedule,
          projectId: draft.projectId || undefined
        })
      }
      closeEditor()
    } catch (e) {
      setSaveError(String(e))
    }
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  // "Repeat this" from a chat: open the editor prefilled with that prompt.
  // Runs every weekday morning by default — the most common ask; one click to change.
  const pendingDraft = useAutomationDraftStore((s) => s.pending)
  useEffect(() => {
    if (!pendingDraft) return
    const seed = useAutomationDraftStore.getState().take()
    if (!seed) return
    openCreate({
      name: seed.name || '',
      prompt: seed.prompt,
      trigger: 'weekdays',
      hour: '09',
      minute: '00',
      projectId: seed.projectId && seed.projectId !== '__general__' ? seed.projectId : ''
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraft])

  const templates = useMemo(
    () => [
      // Everyday work first (most people), then developer templates.
      { title: 'Morning briefing', desc: 'Search the web for today\'s news on the topics I care about and give me a 5-bullet briefing with links.', badge: 'Every weekday', trigger: 'weekdays' as TriggerType, preset: { hour: '08', minute: '30' } },
      { title: 'Inbox digest', desc: 'Read my unread Gmail from the last day and list what needs a reply, with a one-line draft for each.', badge: 'Every weekday', trigger: 'weekdays' as TriggerType, preset: { hour: '09', minute: '00' } },
      { title: 'Weekly summary', desc: 'Summarize what changed this week in my Documents/Reports folder into a short report I can send to my team.', badge: 'Weekly', trigger: 'weekly' as TriggerType, preset: { hour: '17', minute: '00', weekday: '5' } },
      { title: 'Tidy Downloads', desc: 'Sort new files in my Downloads folder into subfolders by type (documents, images, installers) and tell me what moved.', badge: 'Weekly', trigger: 'weekly' as TriggerType, preset: { hour: '18', minute: '00', weekday: '5' } },
      { title: 'Daily report', desc: 'Summarize yesterday\'s work, open todos, blockers, and next priorities as a markdown report.', badge: 'Daily', trigger: 'daily' as TriggerType, preset: { hour: '18', minute: '00' } },
      { title: 'Web / price monitor', desc: 'Open the target URL and check for changes against the previous snapshot in the reports folder; report only what changed (price, stock, notices).', badge: 'Interval', trigger: 'interval' as TriggerType, preset: { intervalMin: '30' } },
      { title: 'RSS digest', desc: 'Fetch the RSS feed URL and summarize new posts into a short digest.', badge: 'Daily', trigger: 'daily' as TriggerType, preset: { hour: '07', minute: '00' } },
      { title: 'Issue triage', desc: 'Review latest issues and propose priorities and owners.', badge: 'Daily', trigger: 'daily' as TriggerType, preset: { hour: '09', minute: '00' } },
      { title: 'Changelog draft', desc: 'Summarize merged PRs this week into release-note draft.', badge: 'Weekly', trigger: 'weekly' as TriggerType, preset: { hour: '10', minute: '00', weekday: '5' } },
      { title: 'Repo audit', desc: 'Audit open PRs and identify blockers or risky changes.', badge: 'Manual', trigger: 'daily' as TriggerType, preset: { hour: '12', minute: '00' } }
    ],
    []
  )

  const exportAutomations = async (): Promise<void> => {
    if (routines.length === 0) {
      setImportMsg('Nothing to export yet')
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
    if (saved) setImportMsg('Exported')
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
      setImportMsg(added > 0 ? `${'Imported'} (${added})` : 'No valid automations in the file')
      await refresh()
    } catch {
      setImportMsg('Import failed — not a valid automation file')
    }
  }

  const bindings = useKeybindingsStore((s) => s.bindings)
  const sidebarShortcut = formatCombo(bindings['toggle-sidebar'])

  return (
    <main className="automation-page">
      <div className="chat-header">
        <Tooltip label={'Toggle sidebar'} shortcut={sidebarShortcut} placement="bottom">
          <button className="sidebar-toggle-btn close-sidebar-btn" onClick={onToggleSidebar} aria-label={'Toggle sidebar'}>
            <PanelLeft size={18} />
          </button>
        </Tooltip>
        <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
        <div className="chat-header-spacer" />
        <span className="automation-import-msg">{importMsg}</span>
        <button className="automation-tool-btn" onClick={() => void importAutomations()} title={'Import'}>{'Import'}</button>
        <button className="automation-tool-btn" onClick={() => void exportAutomations()} title={'Export'}>{'Export'}</button>
        <Button className="automation-header-btn" onClick={() => openCreate()}>
          {'New automation'}
        </Button>
      </div>

      <section className="automation-content">
        <div className="automation-shell">
          <div className="automation-page-head">
            <h2>{'Automations'}</h2>
            <p className="settings-desc">{'Review, run, and toggle recurring tasks.'}</p>
          </div>

          {routines.length === 0 && (
            <div className="automation-hero">
              <div className="automation-hero-icon" aria-hidden="true">
                <CalendarCheck size={32} />
              </div>
              <h3>{'Set up automations'}</h3>
              <p>{'Use agents to handle recurring work on a cadence you choose.'}</p>
              <Button className="automation-cta" onClick={() => openCreate()}>{'Start automating'}</Button>
            </div>
          )}

          {routines.length > 0 && (
            <div className="automation-page-head">
              <h3>{'Your automations'}</h3>
            </div>
          )}
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
                  {' · '}{'Next:'} {formatRunTime(routine.nextRunAt)}
                  {routine.lastRunAt > 0 && (
                    <>
                      {' · '}
                      {'Last:'} {formatRunTime(routine.lastRunAt)}
                    </>
                  )}
                  {runningIds.has(routine.id) && <span className="settings-badge automation-running-badge"> {'Running'}</span>}
                </p>
                {routine.lastResult?.trim() ? (
                  <p className="automation-card-result" title={routine.lastResult}>
                    {routine.lastResult.slice(0, 160)}
                    {routine.lastResult.length > 160 ? '…' : ''}
                  </p>
                ) : null}
                <div className="automation-card-actions">
                  <button
                    className="test-btn"
                    disabled={runningIds.has(routine.id)}
                    onClick={() => void runNow(routine.id)}
                  >
                    {'Run now'}
                  </button>
                  <button
                    type="button"
                    className="test-btn"
                    onClick={() => openEdit(routine)}
                    title={'Edit'}
                  >
                    {'Edit'}
                  </button>
                  <Switch
                    checked={routine.enabled}
                    onCheckedChange={(v) => void toggle(routine.id, v)}
                    title={'On: runs on schedule · Off: paused'}
                    aria-label={'On: runs on schedule · Off: paused'}
                  />
                  <button
                    className="delete-btn"
                    onClick={() => setConfirmDeleteRoutine({ id: routine.id, name: routine.name })}
                    aria-label={'Delete automation'}
                    title={'Delete automation'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}

          </div>

          <details className="automation-templates" open={routines.length === 0}>
            <summary className="automation-page-head">
              <h3>{'Start from a template'}</h3>
            </summary>
            <div className="automation-grid">
              {templates.map((card) => {
                const open = (): void =>
                  openCreate({ name: card.title, prompt: card.desc, trigger: card.trigger, ...card.preset })
                return (
                <article
                  key={card.title}
                  className="automation-card example"
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => activateOnKey(e, open)}
                >
                  <div className="automation-card-head">
                    <h4>{card.title}</h4>
                    <span className="settings-badge">{card.badge}</span>
                  </div>
                  <p className="automation-card-desc">{card.desc}</p>
                </article>
                )
              })}
            </div>
          </details>

        </div>
      </section>

      {showEditor && (
        <div className="automation-modal-backdrop" onClick={closeEditor}>
          <div
            ref={automationDialogRef}
            className="automation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="automation-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="automation-modal-head">
              <h3 id="automation-modal-title">{editingId ? 'Edit automation' : 'New automation'}</h3>
              <button type="button" className="automation-close" onClick={closeEditor} aria-label={'Close'} title={'Close'}>
                ×
              </button>
            </div>

            <div className="automation-form">
              <div className="automation-field">
                <label>{'Name'}</label>
                <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={'Morning briefing'} />
              </div>

              <div className="automation-form-row">
                <div className="automation-field">
                  <label>{'When'}</label>
                  <Select value={draft.trigger} onChange={(e) => setDraft((d) => ({ ...d, trigger: e.target.value as TriggerType }))}>
                    <option value="daily">{'Daily'}</option>
                    <option value="weekdays">{'Every weekday'}</option>
                    <option value="weekly">{'Weekly'}</option>
                    <option value="interval">{'Interval'}</option>
                    <option value="file_watch">{'When a file changes'}</option>
                    <option value="cron">{'Custom (cron)'}</option>
                  </Select>
                </div>
                {draft.trigger === 'weekly' && (
                  <div className="automation-field">
                    <label>{'Weekday'}</label>
                    <Select value={draft.weekday} onChange={(e) => setDraft((d) => ({ ...d, weekday: e.target.value }))}>
                      {[0, 1, 2, 3, 4, 5, 6].map((w) => <option key={w} value={w}>{tx(`settings.automationSection.weekdays.${w}`)}</option>)}
                    </Select>
                  </div>
                )}
                {draft.trigger === 'interval' && (
                  <div className="automation-field">
                    <label>{'Interval (min)'}</label>
                    <Input type="number" min={1} value={draft.intervalMin} onChange={(e) => setDraft((d) => ({ ...d, intervalMin: e.target.value }))} />
                  </div>
                )}
                {(draft.trigger === 'daily' || draft.trigger === 'weekdays' || draft.trigger === 'weekly') && (
                  <>
                    <div className="automation-field">
                      <label>{'Hour'}</label>
                      <Select value={draft.hour} onChange={(e) => setDraft((d) => ({ ...d, hour: e.target.value }))}>
                        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => <option key={h} value={h}>{h}:00</option>)}
                      </Select>
                    </div>
                    <div className="automation-field">
                      <label>{'Minute'}</label>
                      <Select value={draft.minute} onChange={(e) => setDraft((d) => ({ ...d, minute: e.target.value }))}>
                        {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>:{m}</option>)}
                      </Select>
                    </div>
                  </>
                )}
                {draft.trigger === 'cron' && (
                  <div className="automation-field">
                    <label>{'Cron expression (minute hour day month weekday)'}</label>
                    <Input
                      value={draft.cronExpr}
                      onChange={(e) => setDraft((d) => ({ ...d, cronExpr: e.target.value }))}
                      placeholder="0 9 * * 1-5"
                    />
                  </div>
                )}
                {draft.trigger === 'file_watch' && (
                  <>
                    <div className="automation-field">
                      <label>{'File or folder to watch'}</label>
                      <Input
                        value={draft.watchPath}
                        onChange={(e) => setDraft((d) => ({ ...d, watchPath: e.target.value }))}
                        placeholder={'/Users/me/Documents/Reports'}
                      />
                    </div>
                    <div className="automation-field">
                      <label>{'Wait after a change (min)'}</label>
                      <Input
                        type="number"
                        min={1}
                        value={draft.debounceMin}
                        onChange={(e) => setDraft((d) => ({ ...d, debounceMin: e.target.value }))}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="automation-field">
                <label>{'Project'}</label>
                <Select value={draft.projectId} onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}>
                  <option value="">{'No project'}</option>
                  {userProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <span className="automation-field-hint">{'Without a project, this automation runs as a general chat.'}</span>
              </div>

              <div className="automation-field">
                <label>{'What should it do?'}</label>
                <Textarea value={draft.prompt} onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))} rows={4} placeholder={'e.g. Find today\'s industry news and summarize it in 5 bullets'} />
              </div>

              <details className="automation-advanced" open={draft.stepsText.trim().length > 0 || Number(draft.maxRetries) > 0}>
                <summary>{'Advanced'}</summary>
              <div className="automation-field">
                <label>{'Run as steps (one per line, optional)'}</label>
                <Textarea
                  value={draft.stepsText}
                  onChange={(e) => setDraft((d) => ({ ...d, stepsText: e.target.value }))}
                  rows={3}
                  placeholder={`Step 1: collect…
Step 2: summarize…`}
                />
              </div>
              <div className="automation-form-row">
                <div className="automation-field">
                  <label>{'Retries if it fails'}</label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={draft.maxRetries}
                    onChange={(e) => setDraft((d) => ({ ...d, maxRetries: e.target.value }))}
                  />
                </div>
                <div className="automation-field">
                  <label>{'Wait before retrying (sec)'}</label>
                  <Input
                    type="number"
                    min={10}
                    value={draft.retryDelaySec}
                    onChange={(e) => setDraft((d) => ({ ...d, retryDelaySec: e.target.value }))}
                  />
                </div>
              </div>

              </details>
            </div>

            {saveError && (
              <div className="settings-row-desc mcp-form-error" style={{ padding: '0 16px 8px' }}>
                {saveError}
              </div>
            )}

            <div className="automation-modal-actions">
              <span className="automation-modal-hint">
                {editingId ? 'Save changes — the next scheduled run uses the updated prompt and schedule.' : 'Save it, then use Run now to test it right away.'}
              </span>
              <div className="automation-modal-actions-buttons">
                <Button type="button" variant="secondary" onClick={closeEditor}>
                  {'Cancel'}
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveAutomation()}
                  disabled={!canSave}
                >
                  {'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteRoutine && (
        <ConfirmDialog
          title={`${confirmDeleteRoutine.name} ${'Delete'}`}
          message={'Delete this automation? This can\'t be undone.'}
          confirmLabel={'Confirm'}
          cancelLabel={'Cancel'}
          onConfirm={() => { void remove(confirmDeleteRoutine.id); setConfirmDeleteRoutine(null) }}
          onCancel={() => setConfirmDeleteRoutine(null)}
        />
      )}
    </main>
  )
}
