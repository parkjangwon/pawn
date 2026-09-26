import { create } from 'zustand'

/**
 * Questions the agent asks the user mid-turn (ask_user / request_plan_approval).
 *
 * The agent loop awaits the answer like a permission prompt, but questions
 * don't time out — a real decision can take a while. Stop / session teardown
 * aborts them through the turn's AbortSignal.
 */

export interface QuestionOption {
  label: string
  description?: string
}

export type QuestionKind = 'question' | 'plan_approval'

export interface UserQuestion {
  id: string
  sessionId: string
  kind: QuestionKind
  question: string
  /** Optional context shown above the options (e.g. the plan to approve). */
  details?: string
  options: QuestionOption[]
  multiSelect: boolean
  /** Show a free-text "Other" answer. */
  allowOther: boolean
  createdAt: number
}

export interface QuestionAnswer {
  /** Chosen option labels (in option order). */
  selected: string[]
  /** Free-text answer, when given. */
  text?: string
  /** User dismissed without answering. */
  dismissed?: boolean
  /** Turn was stopped while waiting. */
  aborted?: boolean
}

interface QuestionState {
  pending: UserQuestion[]
  ask: (
    q: Omit<UserQuestion, 'id' | 'createdAt'>,
    signal?: AbortSignal
  ) => Promise<QuestionAnswer>
  answer: (id: string, answer: QuestionAnswer) => void
  /** Resolve every pending question for a session as aborted. */
  cancelForSession: (sessionId: string) => void
  forSession: (sessionId: string | null | undefined) => UserQuestion | undefined
}

const MAX_PENDING = 12
const resolvers = new Map<string, { resolve: (a: QuestionAnswer) => void; cleanup: () => void }>()
let counter = 0

export const useQuestionStore = create<QuestionState>((set, get) => ({
  pending: [],

  ask: (q, signal) =>
    new Promise<QuestionAnswer>((resolve) => {
      if (signal?.aborted) {
        resolve({ selected: [], aborted: true })
        return
      }
      if (get().pending.length >= MAX_PENDING) {
        resolve({ selected: [], dismissed: true })
        return
      }
      const id = `q-${Date.now().toString(36)}-${++counter}`
      let settled = false
      const finish = (a: QuestionAnswer): void => {
        if (settled) return
        settled = true
        resolvers.get(id)?.cleanup()
        resolvers.delete(id)
        set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
        resolve(a)
      }
      const onAbort = (): void => finish({ selected: [], aborted: true })
      signal?.addEventListener('abort', onAbort, { once: true })
      resolvers.set(id, {
        resolve: finish,
        cleanup: () => signal?.removeEventListener('abort', onAbort)
      })
      set((s) => ({ pending: [...s.pending, { ...q, id, createdAt: Date.now() }] }))
      notifyWaiting(q)
    }),

  answer: (id, a) => {
    resolvers.get(id)?.resolve(a)
  },

  cancelForSession: (sessionId) => {
    for (const q of get().pending) {
      if (q.sessionId === sessionId) resolvers.get(q.id)?.resolve({ selected: [], aborted: true })
    }
  },

  forSession: (sessionId) => (sessionId ? get().pending.find((q) => q.sessionId === sessionId) : undefined)
}))

/** OS notification when the app is in the background (a blocked turn is easy to miss). */
function notifyWaiting(q: Omit<UserQuestion, 'id' | 'createdAt'>): void {
  try {
    if (typeof document !== 'undefined' && document.hasFocus()) return
    void window.api?.notification?.send?.('Pawn', q.question.slice(0, 140))?.catch?.(() => {})
  } catch {
    /* optional */
  }
}

/** Human-readable answer for the tool result the model sees. */
export function formatAnswerForModel(q: Pick<UserQuestion, 'kind' | 'options'>, a: QuestionAnswer): string {
  if (a.aborted) return 'The user stopped the turn before answering.'
  if (a.dismissed) return 'The user dismissed the question without answering. Do not assume an answer; continue with what you can do, or stop and summarize.'
  const parts: string[] = []
  if (a.selected.length) {
    parts.push(
      a.selected.length === 1
        ? `The user chose: ${a.selected[0]}`
        : `The user chose: ${a.selected.map((s) => `"${s}"`).join(', ')}`
    )
  }
  if (a.text?.trim()) parts.push(`${a.selected.length ? 'They added' : 'The user answered'}: ${a.text.trim()}`)
  if (!parts.length) return 'The user submitted an empty answer.'
  return parts.join('\n')
}

export function __resetQuestionsForTests(): void {
  for (const r of resolvers.values()) r.cleanup()
  resolvers.clear()
  useQuestionStore.setState({ pending: [] })
}
