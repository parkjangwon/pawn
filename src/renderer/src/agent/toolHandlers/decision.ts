import type { ToolHandler } from './types'
import type { ToolResult } from '../toolDefinitionsTypes'
import { callDecisionModel, refreshDecisionStatus } from '../decision'

const MAX_TOOL_QUESTIONS = 32
const MAX_ITEMS = 50
const ITEM_CONCURRENCY = 4

type WireQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }

/** Tool-call questions (array, friendly names) → TypeSafe wire questions. */
export function buildDecisionQuestions(raw: unknown): { ok: true; questions: Record<string, WireQuestion> } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).map(([id, q]) => ({ id, ...(q as object) })) : []
  if (!list.length) return { ok: false, error: 'questions is required (1–32 questions)' }
  if (list.length > MAX_TOOL_QUESTIONS) return { ok: false, error: `Too many questions (${list.length} > ${MAX_TOOL_QUESTIONS}); split the call` }
  const out: Record<string, WireQuestion> = {}
  list.forEach((q, i) => {
    const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>
    let id = String(o.id ?? '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
    if (!id || out[id]) id = `${id || 'q'}_${i + 1}`
    const instructions = String(o.question ?? o.instructions ?? '').trim()
    const type = String(o.type ?? '').trim().toLowerCase()
    const opts = Array.isArray(o.options)
      ? o.options.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).label ?? '') : String(x ?? ''))).map((s) => s.trim()).filter(Boolean)
      : Array.isArray(o.criteria)
        ? o.criteria.map((s) => String(s ?? '').trim()).filter(Boolean)
        : []
    if (type === 'yes_no' || type === 'yesno' || type === 'noul' || type === 'bool' || type === 'boolean') {
      out[id] = { type: 'noul', instructions }
    } else if (type === 'score' || type === 'rating' || type === 'scale') {
      out[id] = { type: 'score', instructions, criteria: opts }
    } else {
      const descs = (o.option_descriptions && typeof o.option_descriptions === 'object' ? o.option_descriptions : {}) as Record<string, unknown>
      const criteria: Record<string, string | null> = {}
      for (const label of opts) criteria[label] = typeof descs[label] === 'string' && (descs[label] as string).trim() ? String(descs[label]).trim() : null
      out[id] = { type: 'choice', instructions, criteria }
    }
  })
  return { ok: true, questions: out }
}

/** JSON text becomes structured state; anything else stays text. */
export function parseDecisionState(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
  const t = s.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.parse(t)
    } catch {
      /* not JSON — keep as text */
    }
  }
  return s
}

const pct = (p: number): string => `${Math.round(p * 100)}%`

function topProbs(probs: Record<string, number>, n = 4): string {
  return Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(', ')
}

export function formatAnswer(id: string, a: DecisionAnswerDto): string {
  if (a.type === 'noul') return `${id}: ${a.noul >= 0.5 ? 'yes' : 'no'} (p_yes=${a.noul.toFixed(2)})`
  if (a.type === 'choice') {
    return `${id}: ${a.choice} (confidence ${a.confidence.toFixed(2)}) — ${topProbs(a.probabilities)}`
  }
  const levels = Object.keys(a.legend).length || Object.keys(a.probabilities).length
  const top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0]
  const label = top ? String(a.legend[top[0]] ?? top[0]) : ''
  return `${id}: ${a.score.toFixed(2)} on 0–${Math.max(1, levels - 1)} (confidence ${a.confidence.toFixed(2)})${label ? ` — most likely "${label}" ${pct(top![1])}` : ''}`
}

async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const i = next++
      out[i] = await fn(list[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return out
}

const decide: ToolHandler = async (call, _projectPath, signal): Promise<ToolResult> => {
  if (!window.api?.decision?.decide) {
    return { toolCallId: call.id, content: 'Decision models are only available in the desktop app.', isError: true }
  }
  const status = await refreshDecisionStatus()
  if (!status?.active) {
    return {
      toolCallId: call.id,
      content: 'No decision model is active. The user can add TypeSafe or Ollaya in Settings → Decision models. Answer the question yourself instead.',
      isError: true
    }
  }
  const built = buildDecisionQuestions(call.arguments.questions)
  if (!built.ok) return { toolCallId: call.id, content: built.error, isError: true }
  const items = Array.isArray(call.arguments.items) ? call.arguments.items : null
  if (items && items.length > MAX_ITEMS) {
    return { toolCallId: call.id, content: `Too many items (${items.length} > ${MAX_ITEMS}); pre-filter or split the call.`, isError: true }
  }
  const states = items && items.length ? items.map(parseDecisionState) : [parseDecisionState(call.arguments.state)]
  if (states.every((s) => s === '' || s == null)) {
    return { toolCallId: call.id, content: 'state (or items) is required', isError: true }
  }

  const results = await mapLimit(states, ITEM_CONCURRENCY, async (state) => {
    if (signal?.aborted) return { ok: false as const, error: 'Cancelled' }
    return (await callDecisionModel({ state, questions: built.questions })) ?? { ok: false as const, error: 'Decision call failed' }
  })

  const ok = results.filter((r): r is Extract<DecisionResultDto, { ok: true }> => r.ok)
  const first = ok[0]
  const where = first ? `${first.model} via ${first.provider.name}${first.provider.local ? ' (local)' : ''}` : status.active.name
  if (!ok.length) {
    const err = results.find((r) => !r.ok) as { error?: string } | undefined
    return { toolCallId: call.id, content: `Decision model error (${where}): ${err?.error || 'unknown error'}`, isError: true }
  }
  const ms = ok.map((r) => r.latencyMs).sort((a, b) => a - b)
  const median = ms[Math.floor(ms.length / 2)] ?? 0
  const lines: string[] = [
    `# Decisions — ${where}, ${states.length > 1 ? `${ok.length}/${states.length} inputs, median ` : ''}${median} ms`
  ]
  results.forEach((r, i) => {
    const prefix = states.length > 1 ? `[${i + 1}] ` : ''
    if (!r.ok) {
      lines.push(`${prefix}error: ${r.error}`)
      return
    }
    const answers = Object.entries(r.answers).map(([id, a]) => formatAnswer(id, a))
    if (states.length > 1) lines.push(`${prefix}${answers.join(' | ')}`)
    else lines.push(...answers.map((a) => `- ${a}`))
  })
  lines.push('', 'Probabilities are calibrated estimates, not guarantees. Treat confidence below 0.6 as uncertain.')
  return { toolCallId: call.id, content: lines.join('\n') }
}

export const decisionHandlers: Record<string, ToolHandler> = { decide }
