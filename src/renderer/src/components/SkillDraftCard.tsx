import { useEffect, useId, useState } from 'react'
import { tx } from '../i18n'
import { Sparkles } from 'lucide-react'
import { buildAutomationPrompt, buildRunPrompt, sameSkill, type SkillDraft } from '../agent/recordReplay'
import { clearProjectContextCache } from '../agent/skills'
import { openAutomationDraft } from '../stores/automationDraft'
import ConfirmDialog from './ConfirmDialog'
import './RecordingBar.css'

type SaveState = 'checking' | 'new' | 'saved' | 'changed' | 'unavailable'

/** Tell the composer (and its /skill list) that skills changed / what to prefill. */
export function notifySkillsChanged(): void {
  clearProjectContextCache()
  window.dispatchEvent(new Event('pawn:skills-changed'))
}

export function prefillComposer(text: string): void {
  window.dispatchEvent(new CustomEvent('pawn:composer-prefill', { detail: { text } }))
}

/**
 * A SKILL.md draft inside an assistant message (Record & Replay drafts and
 * agent revisions): save it to ~/.agents/skills, run it, or schedule it.
 */
export default function SkillDraftCard({ draft, projectId }: { draft: SkillDraft; projectId?: string | null }): React.JSX.Element {
  const [state, setState] = useState<SaveState>('checking')
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const uid = useId()
  const api = window.api?.localSkills

  useEffect(() => {
    let alive = true
    if (!api) {
      setState('unavailable')
      return
    }
    setState('checking')
    void api
      .read(draft.name)
      .then((r) => {
        if (!alive) return
        if (r.ok) {
          setPath(r.path)
          setState(sameSkill(r.content, draft.content) ? 'saved' : 'changed')
        } else setState('new')
      })
      .catch(() => alive && setState('new'))
    return () => {
      alive = false
    }
  }, [api, draft.name, draft.content])

  const save = async (overwrite: boolean): Promise<boolean> => {
    if (!api) return false
    setBusy(true)
    setError('')
    try {
      const r = await api.save(draft.name, draft.content, { overwrite })
      if (r.ok) {
        setPath(r.path)
        setState('saved')
        notifySkillsChanged()
        return true
      }
      if (r.exists) {
        setConfirmReplace(true)
        return false
      }
      setError(r.error)
      return false
    } finally {
      setBusy(false)
    }
  }

  const ensureSaved = async (): Promise<boolean> => {
    if (state === 'saved') return true
    return save(false)
  }

  const run = async (): Promise<void> => {
    if (!(await ensureSaved())) return
    if (draft.inputs.length && !running) {
      setRunning(true)
      return
    }
    prefillComposer(buildRunPrompt(draft.name, draft.inputs, values, 'en'))
    setRunning(false)
  }

  const automate = async (): Promise<void> => {
    if (!(await ensureSaved())) return
    const title = /^#\s+(.+)$/m.exec(draft.content)?.[1]?.trim() || draft.name
    openAutomationDraft({ prompt: buildAutomationPrompt(draft.name, draft.inputs, values), projectId: projectId || undefined, name: title })
  }

  const badge =
    state === 'saved' ? (
      <span className="skill-card-badge saved">{'Saved'}</span>
    ) : state === 'changed' ? (
      <span className="skill-card-badge">{'Differs from saved skill'}</span>
    ) : state === 'new' ? (
      <span className="skill-card-badge">{'Draft'}</span>
    ) : null

  return (
    <div className="skill-card" role="group" aria-label={`Skill ${draft.name}`}>
      <div className="skill-card-head">
        <Sparkles size={15} aria-hidden />
        <code>{draft.name}</code>
        {badge}
      </div>
      {draft.description && <div className="skill-card-desc">{draft.description}</div>}
      {draft.inputs.length > 0 && (
        <div className="skill-card-inputs" aria-label={'Inputs'}>
          <span>{'Inputs'}:</span>
          {draft.inputs.map((i) => (
            <code key={i.name} title={i.description}>
              {i.name}
              {i.required ? '' : '?'}
            </code>
          ))}
        </div>
      )}
      {running && (
        <form
          className="skill-run-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          {draft.inputs.map((i, idx) => (
            <div key={i.name} style={{ display: 'contents' }}>
              <label htmlFor={`${uid}-${i.name}`} title={i.description}>
                {i.name}
                {i.required ? ' *' : ''}
              </label>
              <input
                id={`${uid}-${i.name}`}
                autoFocus={idx === 0}
                value={values[i.name] ?? ''}
                placeholder={i.example || i.description.slice(0, 80)}
                onChange={(e) => setValues({ ...values, [i.name]: e.target.value })}
              />
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="rec-btn" onClick={() => setRunning(false)}>
              {'Cancel'}
            </button>
            <button type="submit" className="rec-btn primary">
              {'Put in the message box'}
            </button>
          </div>
        </form>
      )}
      {!running && (
        <div className="skill-card-actions">
          {state !== 'saved' && state !== 'unavailable' && (
            <button type="button" className="rec-btn primary" disabled={busy || state === 'checking'} onClick={() => void (state === 'changed' ? setConfirmReplace(true) : save(false))}>
              {state === 'changed' ? 'Update saved skill' : 'Save skill'}
            </button>
          )}
          <button type="button" className="rec-btn" disabled={busy || state === 'checking' || state === 'unavailable'} onClick={() => void run()}>
            {'Run it'}
          </button>
          <button type="button" className="rec-btn" disabled={busy || state === 'checking' || state === 'unavailable'} onClick={() => void automate()}>
            {'Automate'}
          </button>
          <button type="button" className="rec-btn" onClick={() => prefillComposer(`Change the ${draft.name} skill: `)}>
            {'Refine'}
          </button>
          <span className="rec-spacer" />
          <button type="button" className="rec-link" aria-expanded={preview} onClick={() => setPreview((v) => !v)}>
            {preview ? 'Hide SKILL.md' : 'Show SKILL.md'}
          </button>
        </div>
      )}
      {state === 'saved' && path && <div className="skill-card-path">{path}</div>}
      {error && (
        <div className="rec-error" role="alert">
          {error}
        </div>
      )}
      {preview && <pre className="skill-card-preview">{draft.content}</pre>}
      {confirmReplace && (
        <ConfirmDialog
          title={`Replace ${draft.name}?`}
          message={'A skill with this name is already saved. Replace it with this version?'}
          confirmLabel={'Update saved skill'}
          cancelLabel={'Cancel'}
          onConfirm={() => {
            setConfirmReplace(false)
            void save(true)
          }}
          onCancel={() => setConfirmReplace(false)}
        />
      )}
    </div>
  )
}
