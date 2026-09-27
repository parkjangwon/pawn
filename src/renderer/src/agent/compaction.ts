/**
 * Model-written compaction summaries.
 *
 * When the transcript crosses the compaction threshold, the older part is
 * summarized by a cheap model into a structured handoff (goal, decisions,
 * changed files, open work, failing checks). Any failure — no model, timeout,
 * provider error, empty answer — falls back to the heuristic digest, so
 * compaction never blocks or breaks a turn.
 */

import { useProviderStore } from '../stores/provider'
import { useUsageStore, type CallUsage } from '../stores/usage'
import type { ModelEntry, Provider } from '../types/provider'
import { fetchWithRetry } from './llm'
import { isProviderAvailable } from './router'
import { authHeadersForChat, providerChatUrl } from './testProvider'
import {
  buildCompactionSummary,
  compactionCut,
  estimateTokens,
  type CompactOptions,
  type TranscriptEntry
} from './transcript'

export const SUMMARY_SYSTEM_PROMPT = `You compress the earlier part of a coding-agent session into a handoff note for the same agent, which will continue the work without seeing the original messages.

Write concise Markdown with exactly these sections (omit a section only if it would be empty):
## Goal
What the user ultimately wants, including constraints and preferences they stated.
## Decisions & findings
Facts learned about the codebase, root causes, chosen approaches, and rejected ones (with why).
## Changes made
Files created/edited/deleted and what changed in each (one line per file).
## Open work
What is still unfinished or was promised next, in order.
## Problems
Failing tests/checks, errors, and blockers with the exact error text when short.

Rules: be specific (names, paths, commands, error messages). Never invent facts. No preamble. Max ~600 words.`

/** Rendered transcript sent to the summarizer is capped to keep the call cheap. */
const SUMMARY_INPUT_CHARS = 60_000
const SUMMARY_MAX_TOKENS = 1200
const SUMMARY_TIMEOUT_MS = 45_000

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[${text.length - max} chars cut]` : text
}

/** Plain-text rendering of transcript entries for the summarizer. */
export function renderForSummary(entries: TranscriptEntry[], maxChars = SUMMARY_INPUT_CHARS): string {
  const lines: string[] = []
  for (const e of entries) {
    if (e.role === 'summary') lines.push(`[earlier summary]\n${clip(e.content, 6000)}`)
    else if (e.role === 'user') lines.push(`[user]\n${clip(e.content, 3000)}`)
    else if (e.role === 'assistant') {
      const calls = (e.toolCalls || [])
        .map((tc) => `  → ${tc.name}(${clip(JSON.stringify(tc.arguments), 300)})`)
        .join('\n')
      const text = e.content?.trim() ? clip(e.content.trim(), 2000) : ''
      lines.push(`[assistant]${text ? `\n${text}` : ''}${calls ? `\n${calls}` : ''}`)
    } else if (e.role === 'tool') {
      lines.push(`[tool ${e.name}${e.isError ? ' ERROR' : ''}]\n${clip(e.content, e.isError ? 1200 : 600)}`)
    }
  }
  // Keep the newest material when over budget: the tail is what matters most.
  let out = lines.join('\n\n')
  if (out.length > maxChars) out = '…[earliest part omitted]\n\n' + out.slice(out.length - maxChars)
  return out
}

const TIER_RANK: Record<string, number> = { low: 0, mid: 1, high: 2 }

/** Cheapest enabled, available model whose window fits the summary request. */
export function pickSummaryModel(inputTokens: number): { provider: Provider; model: ModelEntry } | null {
  const { providers, models } = useProviderStore.getState()
  const byId = new Map(providers.filter((p) => p.enabled && p.apiKey?.trim()).map((p) => [p.id, p]))
  const pool: Array<{ provider: Provider; model: ModelEntry }> = []
  for (const model of models) {
    if (!model.enabled) continue
    const provider = byId.get(model.providerId)
    if (!provider || !isProviderAvailable(provider.id)) continue
    const window = model.contextWindow || 128_000
    if (window < inputTokens + SUMMARY_MAX_TOKENS + 2_000) continue
    pool.push({ provider, model })
  }
  if (pool.length === 0) return null
  pool.sort((a, b) => {
    const tier = (TIER_RANK[a.model.tier] ?? 1) - (TIER_RANK[b.model.tier] ?? 1)
    if (tier !== 0) return tier
    const price = (a.model.pricing?.input ?? 1e9) - (b.model.pricing?.input ?? 1e9)
    return price
  })
  return pool[0]
}

export function buildSummaryRequest(
  provider: Pick<Provider, 'apiFormat'>,
  modelId: string,
  transcriptText: string
): Record<string, unknown> {
  const user = `Session so far:\n\n${transcriptText}\n\nWrite the handoff note now.`
  if (provider.apiFormat === 'claude') {
    return {
      model: modelId,
      max_tokens: SUMMARY_MAX_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }]
    }
  }
  return {
    model: modelId,
    max_tokens: SUMMARY_MAX_TOKENS,
    stream: false,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: user }
    ]
  }
}

/** Extract text + usage from a non-streaming Claude or OpenAI-style response. */
export function parseSummaryResponse(json: unknown): { text: string; usage: CallUsage } {
  const j = (json || {}) as Record<string, any>
  let text = ''
  if (Array.isArray(j.content)) {
    text = j.content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('')
  } else if (Array.isArray(j.choices)) {
    const msg = j.choices[0]?.message
    text = typeof msg?.content === 'string' ? msg.content : ''
  }
  const u = j.usage || {}
  const usage: CallUsage = {
    inputTokens: Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0,
    outputTokens: Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0,
    cacheReadTokens: Number(u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? 0) || 0,
    cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0) || 0
  }
  return { text: text.trim(), usage }
}

/** One-shot summary call. Returns null on any failure (caller falls back). */
export async function summarizeWithModel(
  older: TranscriptEntry[],
  opts: { sessionId: string; signal?: AbortSignal }
): Promise<string | null> {
  const transcriptText = renderForSummary(older)
  if (!transcriptText.trim()) return null
  const target = pickSummaryModel(Math.ceil(transcriptText.length / 3))
  if (!target) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal
  try {
    const res = await fetchWithRetry(
      providerChatUrl(target.provider),
      authHeadersForChat(target.provider),
      buildSummaryRequest(target.provider, target.model.modelId, transcriptText),
      window.api?.platform === 'browser',
      signal
    )
    const { text, usage } = parseSummaryResponse(await res.json())
    try {
      useUsageStore.getState().record(opts.sessionId, target.model, usage)
    } catch {
      /* usage is best-effort */
    }
    // A summary that isn't meaningfully shorter than the input is not worth it.
    if (text.length < 40 || text.length > transcriptText.length) return null
    return text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface SmartCompactResult {
  entries: TranscriptEntry[]
  compacted: boolean
  usedModel: boolean
}

/**
 * Compact `entries` keeping a token-budgeted verbatim tail. Uses a model
 * summary when `useModel` is on and a model is reachable, otherwise the
 * heuristic digest. The current plan is always carried over.
 */
export async function compactWithSummary(
  entries: TranscriptEntry[],
  opts: {
    sessionId: string
    contextWindow: number
    plan?: CompactOptions['plan']
    notes?: string
    useModel?: boolean
    signal?: AbortSignal
    summarize?: typeof summarizeWithModel
  }
): Promise<SmartCompactResult> {
  // Keep ~25% of the window verbatim (bounded), so recent reasoning and tool
  // results survive intact while the bulk is folded.
  const keepTokens = Math.round(Math.min(48_000, Math.max(6_000, opts.contextWindow * 0.25)))
  const base: CompactOptions = { keepTokens, minKeep: 4, plan: opts.plan, notes: opts.notes }
  const cut = compactionCut(entries, base)
  if (cut < 0) return { entries, compacted: false, usedModel: false }
  const older = entries.slice(0, cut)
  const recent = entries.slice(cut)
  let llmSummary: string | null = null
  if (opts.useModel !== false) {
    llmSummary = await (opts.summarize ?? summarizeWithModel)(older, {
      sessionId: opts.sessionId,
      signal: opts.signal
    })
  }
  const summary = buildCompactionSummary(older, { ...base, llmSummary: llmSummary ?? undefined })
  const next: TranscriptEntry[] = [{ role: 'summary', content: summary }, ...recent]
  if (estimateTokens(next) >= estimateTokens(entries)) {
    return { entries, compacted: false, usedModel: false }
  }
  return { entries: next, compacted: true, usedModel: llmSummary !== null }
}
