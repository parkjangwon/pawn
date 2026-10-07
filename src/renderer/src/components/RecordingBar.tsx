import { useEffect, useId, useRef, useState } from 'react'
import { tx } from '../i18n'
import { useRecordingStore, type RecordingSources } from '../stores/recording'
import './RecordingBar.css'

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Dot({ live }: { live: boolean }): React.JSX.Element {
  return <span className={`rec-dot${live ? ' live' : ''}`} aria-hidden />
}

/** Setup form: what to show, what changes, what to record. */
function RecordingSetup(): React.JSX.Element {
  const { readiness, starting, error, start, closeSetup, refreshReadiness } = useRecordingStore()
  const [goal, setGoal] = useState('')
  const [inputsHint, setInputsHint] = useState('')
  const [sources, setSources] = useState<RecordingSources>({ browser: true, desktop: true })
  const uid = useId()
  const goalRef = useRef<HTMLTextAreaElement>(null)
  const desktop = readiness?.desktop
  const desktopUsable = !!desktop?.supported && !!desktop.accessibility

  useEffect(() => {
    goalRef.current?.focus()
  }, [])

  useEffect(() => {
    if (desktop && !desktopUsable) setSources((s) => ({ ...s, desktop: false }))
  }, [desktop, desktopUsable])

  // Re-check permissions when the user comes back from System Settings.
  useEffect(() => {
    const onFocus = (): void => void refreshReadiness()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshReadiness])

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    void start({ goal, inputsHint, sources })
  }
  const nothing = !sources.browser && !sources.desktop

  return (
    <form
      className="rec-card rec-setup"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          closeSetup()
        }
      }}
      aria-labelledby={`${uid}-title`}
    >
      <div className="rec-head">
        <Dot live={false} />
        <strong id={`${uid}-title`}>{'Record a workflow'}</strong>
        <span className="rec-sub">{'Show Pawn once, get a reusable skill'}</span>
      </div>
      <label className="rec-field" htmlFor={`${uid}-goal`}>
        <span>{'What will you show?'}</span>
        <textarea
          id={`${uid}-goal`}
          ref={goalRef}
          rows={2}
          value={goal}
          placeholder={'e.g. File this month’s phone bill as an expense in Expensify'}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void start({ goal, inputsHint, sources })
            }
          }}
        />
      </label>
      <label className="rec-field" htmlFor={`${uid}-inputs`}>
        <span>
          {'What changes each time?'} <em>{'(optional)'}</em>
        </span>
        <input id={`${uid}-inputs`} value={inputsHint} placeholder={'e.g. the amount, the receipt file, the month'} onChange={(e) => setInputsHint(e.target.value)} />
      </label>
      <fieldset className="rec-sources">
        <legend>{'Record'}</legend>
        <label className="rec-check">
          <input type="checkbox" checked={sources.browser} onChange={(e) => setSources({ ...sources, browser: e.target.checked })} />
          <span>
            <strong>{'Pawn browser'}</strong>
            <small>{'Clicks, typing and pages in Pawn’s browser, by element name'}</small>
          </span>
        </label>
        <label className={`rec-check${desktopUsable ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            checked={sources.desktop}
            disabled={!desktopUsable}
            onChange={(e) => setSources({ ...sources, desktop: e.target.checked })}
          />
          <span>
            <strong>{'Mac apps'}</strong>
            <small>
              {!desktop
                ? 'Loading…'
                : !desktop.supported
                  ? desktop.error || 'Not available right now'
                  : !desktop.accessibility
                    ? 'Needs the Accessibility permission'
                    : desktop.screenRecording
                      ? 'Clicks, shortcuts, typing and app switches in other apps, with screenshots'
                      : 'Works without screenshots: Screen Recording is off'}
            </small>
          </span>
        </label>
        {desktop?.supported && (!desktop.accessibility || !desktop.screenRecording) && (
          <div className="rec-perm-actions">
            {!desktop.accessibility && (
              <button type="button" className="rec-link" onClick={() => window.api.recorder?.openPermissions('accessibility')?.catch?.(() => {})}>
                {'Open Accessibility settings'}
              </button>
            )}
            {!desktop.screenRecording && (
              <button type="button" className="rec-link" onClick={() => window.api.recorder?.openPermissions('screen')?.catch?.(() => {})}>
                {'Open Screen Recording settings'}
              </button>
            )}
          </div>
        )}
      </fieldset>
      <ul className="rec-tips">
        <li>{'Keep it short: do the task once from start to finish, then stop.'}</li>
        <li>{'Passwords and one-time codes are never recorded. The raw recording is deleted once the skill is written.'}</li>
        <li>{'Stop here, from the menu bar, or press Esc twice.'}</li>
      </ul>
      {error && (
        <div className="rec-error" role="alert">
          {error}
        </div>
      )}
      <div className="rec-actions">
        <button type="button" className="rec-btn" onClick={closeSetup}>
          {'Cancel'}
        </button>
        <button type="submit" className="rec-btn primary rec-start" disabled={starting || nothing}>
          <Dot live={false} />
          {starting ? 'Starting…' : 'Start recording'}
        </button>
      </div>
    </form>
  )
}

/** Live recording: elapsed, steps, last step, Stop / Discard. */
function RecordingLive(): React.JSX.Element {
  const { status, stop, cancel, error } = useRecordingStore()
  const [now, setNow] = useState(Date.now())
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const elapsed = status.startedAt ? now - status.startedAt : status.elapsedMs || 0
  const sources = (status.sources || []).map((s) => (s === 'browser' ? 'Pawn browser' : 'Mac apps')).join(' · ')

  return (
    <div className="rec-card rec-live" role="status" aria-live="polite">
      <div className="rec-head">
        <Dot live />
        <strong>{'Recording'}</strong>
        <span className="rec-num">{clock(elapsed)}</span>
        <span className="rec-sub">{((status.steps || 0) === 1 ? `${status.steps || 0} step` : `${status.steps || 0} steps`)}</span>
        <span className="rec-sub rec-sources-label">{sources}</span>
        <span className="rec-spacer" />
        <button type="button" className="rec-btn" onClick={() => void cancel()} disabled={stopping}>
          {'Discard'}
        </button>
        <button
          type="button"
          className="rec-btn primary rec-stop"
          disabled={stopping}
          onClick={() => {
            setStopping(true)
            void stop().finally(() => setStopping(false))
          }}
        >
          <span className="rec-square" aria-hidden />
          {stopping ? 'Stopping…' : 'Stop and write skill'}
        </button>
      </div>
      {status.goal && <div className="rec-goal">{status.goal}</div>}
      <div className="rec-last">{status.lastStep ? `Last: ${status.lastStep}` : 'Go ahead and do the task. Your steps show up here.'}</div>
      {(status.notes || []).map((n) => (
        <div key={n} className="rec-note">
          {n}
        </div>
      ))}
      {error && (
        <div className="rec-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/** Drafting / failed jobs for the chat on screen. */
function DraftJobs({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const jobs = useRecordingStore((s) => s.jobs)
  const retry = useRecordingStore((s) => s.retry)
  const discard = useRecordingStore((s) => s.discard)
  const mine = Object.entries(jobs).filter(([, j]) => j.sessionId === sessionId)
  if (!mine.length) return null
  return (
    <>
      {mine.map(([id, job]) =>
        job.state === 'drafting' ? (
          <div key={id} className="rec-card rec-drafting" role="status" aria-live="polite">
            <div className="rec-head">
              <span className="rec-spinner" aria-hidden />
              <strong>{'Writing the skill from your recording…'}</strong>
              <span className="rec-sub">{(job.steps === 1 ? `${job.steps} step` : `${job.steps} steps`)}</span>
            </div>
          </div>
        ) : (
          <div key={id} className="rec-card rec-failed" role="alert">
            <div className="rec-head">
              <strong>{'Could not write the skill'}</strong>
              <span className="rec-spacer" />
              <button type="button" className="rec-btn" onClick={() => discard(id)}>
                {'Discard recording'}
              </button>
              <button type="button" className="rec-btn primary" onClick={() => void retry(id)}>
                {'Try again'}
              </button>
            </div>
            {job.error && <div className="rec-error">{job.error}</div>}
            <div className="rec-note">{'The recording is kept in memory until the skill is written, and is gone if you quit.'}</div>
          </div>
        )
      )}
    </>
  )
}

/**
 * Record & Replay strip above the composer (macOS): setup form, the live
 * recording, and drafting progress for the chat on screen.
 */
export default function RecordingBar({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const supported = useRecordingStore((s) => s.supported)
  const setupOpen = useRecordingStore((s) => s.setupOpen)
  const recording = useRecordingStore((s) => s.status.state === 'recording')
  if (!supported) return null
  return (
    <div className="rec-slot">
      {recording ? <RecordingLive /> : setupOpen ? <RecordingSetup /> : null}
      <DraftJobs sessionId={sessionId} />
    </div>
  )
}
