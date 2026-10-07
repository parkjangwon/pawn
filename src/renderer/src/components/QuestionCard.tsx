import { useEffect, useMemo, useRef, useState } from 'react'
import { tx } from '../i18n'
import { X } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { useQuestionStore, type UserQuestion } from '../stores/userQuestions'
import './QuestionCard.css'

/**
 * Inline card for a question the agent is waiting on (ask_user) or a plan it
 * wants approved (request_plan_approval). Keyboard: 1-9 picks an option,
 * Enter submits, Esc dismisses.
 */
export default function QuestionCard({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const question = useQuestionStore((s) => (sessionId ? s.pending.find((q) => q.sessionId === sessionId) : undefined))
  if (!question) return null
  return <QuestionCardInner key={question.id} question={question} />
}

function QuestionCardInner({ question }: { question: UserQuestion }): React.JSX.Element {
  const answer = useQuestionStore((s) => s.answer)
  const [selected, setSelected] = useState<string[]>([])
  const [other, setOther] = useState('')
  const [showPlan, setShowPlan] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const otherRef = useRef<HTMLTextAreaElement>(null)
  const isPlan = question.kind === 'plan_approval'
  const approveLabel = isPlan ? question.options[0]?.label : undefined
  const reviseLabel = isPlan ? question.options[1]?.label : undefined

  const canSubmit = selected.length > 0 || other.trim().length > 0

  const submit = (picked: string[] = selected): void => {
    if (picked.length === 0 && !other.trim()) return
    answer(question.id, { selected: picked, text: other.trim() || undefined })
  }

  const toggle = (label: string): void => {
    if (question.multiSelect) {
      setSelected((cur) => (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]))
      return
    }
    // Single choice without an extra note: answer immediately.
    if (!other.trim()) {
      submit([label])
      return
    }
    setSelected([label])
  }

  // Focus the card so number keys work without clicking first.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  const optionOrder = useMemo(() => question.options.map((o) => o.label), [question.options])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    const inText = e.target instanceof HTMLTextAreaElement
    if (e.key === 'Escape') {
      e.preventDefault()
      answer(question.id, { selected: [], dismissed: true })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && (inText || canSubmit)) {
      e.preventDefault()
      submit()
      return
    }
    if (!inText && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      const label = optionOrder[Number(e.key) - 1]
      if (label) {
        e.preventDefault()
        toggle(label)
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`question-card${isPlan ? ' plan' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${question.id}-title`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="question-card-head">
        <span className="question-card-badge">{isPlan ? 'Plan' : 'Question'}</span>
        <h3 id={`${question.id}-title`} className="question-card-title">
          {question.question}
        </h3>
        <button
          type="button"
          className="question-card-close"
          onClick={() => answer(question.id, { selected: [], dismissed: true })}
          aria-label={'Dismiss (Esc)'}
          title={'Dismiss (Esc)'}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {question.details && (
        <div className="question-card-details">
          <button type="button" className="question-card-details-toggle" onClick={() => setShowPlan((v) => !v)} aria-expanded={showPlan}>
            {showPlan ? 'Hide plan' : 'Show plan'}
          </button>
          {showPlan && (
            <div className="question-card-plan">
              <MarkdownRenderer content={question.details} />
            </div>
          )}
        </div>
      )}

      {isPlan ? (
        <div className="question-card-plan-actions">
          <textarea
            ref={otherRef}
            className="question-card-other"
            rows={2}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder={'Optional notes, or what to change…'}
            aria-label={'Optional notes, or what to change…'}
          />
          <div className="question-card-buttons">
            <button
              type="button"
              className="question-card-btn"
              disabled={!other.trim()}
              onClick={() => reviseLabel && answer(question.id, { selected: [reviseLabel], text: other.trim() })}
            >
              {'Request changes'}
            </button>
            <button
              type="button"
              className="question-card-btn primary"
              onClick={() => approveLabel && answer(question.id, { selected: [approveLabel], text: other.trim() || undefined })}
            >
              {'Approve & build'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {question.options.length > 0 && (
            <div className="question-card-options" role={question.multiSelect ? 'group' : 'radiogroup'}>
              {question.options.map((o, i) => {
                const on = selected.includes(o.label)
                return (
                  <button
                    key={o.label}
                    type="button"
                    role={question.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    className={`question-card-option${on ? ' selected' : ''}`}
                    onClick={() => toggle(o.label)}
                  >
                    <kbd className="question-card-key">{i + 1}</kbd>
                    <span className="question-card-option-text">
                      <span className="question-card-option-label">{o.label}</span>
                      {o.description && <span className="question-card-option-desc">{o.description}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {question.allowOther && (
            <textarea
              ref={otherRef}
              className="question-card-other"
              rows={1}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={question.options.length ? 'Or type your own answer…' : 'Type your answer…'}
              aria-label={question.options.length ? 'Or type your own answer…' : 'Type your answer…'}
            />
          )}
          {(question.multiSelect || question.allowOther) && (
            <div className="question-card-buttons">
              <span className="question-card-hint">{'1-9 to pick · Enter to send · Esc to dismiss'}</span>
              <button type="button" className="question-card-btn primary" disabled={!canSubmit} onClick={() => submit()}>
                {'Answer'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
