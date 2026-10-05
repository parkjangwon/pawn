/**
 * Agent-turn leaf helpers split out of chatLoop.ts (the old path re-exports
 * them). Everything here is self-contained: no agentLoop, no queue — the loop
 * and processQueue stay in chatLoop.ts because they call back into each other.
 */

import i18n from '../i18n'
import { useAppStore } from './app'
import { usePlanStore } from './plan'
import { usePrefsStore } from './prefs'
import { useProviderStore } from './provider'
import { useStreamingStore } from './streaming'
import { useUsageStore } from './usage'
import { loadTranscript, persistTranscript } from './chatTranscript'
import { BASH_NAME, APPLY_PATCH_NAME, TEXT_EDITOR_NAME } from '../agent/nativeTools'
import { compactTranscript, estimateTokens, type TranscriptEntry } from '../agent/transcript'
import { compactWithSummary } from '../agent/compaction'
import type { ToolCall } from '../agent/tools'

export function describeToolAction(tc: ToolCall): string {
  const name = tc.name
  const args = tc.arguments || {}
  const fname = (p?: unknown) => String(p || '').split('/').pop() || 'file'
  if (name === 'read_file') return `Reading ${fname(args.path)}`
  if (name === 'edit_file') return `Editing ${fname(args.path)}`
  if (name === 'write_file') return `Writing ${fname(args.path)}`
  if (name === 'delete_file') return `Deleting ${fname(args.path)}`
  if (name === 'list_dir') return `Listing ${fname(args.path || '.')}`
  if (name === 'grep_search' || name === 'search_files') {
    const q = String(args.query || args.pattern || '').trim()
    return q ? `Searching for "${q.slice(0, 24)}"` : 'Searching codebase'
  }
  if (name === 'shell_exec' || name === BASH_NAME) {
    const cmd = String(args.command || '').trim()
    return cmd ? `Running: ${cmd.slice(0, 30)}` : 'Running shell command'
  }
  if (name === TEXT_EDITOR_NAME) {
    const verb = args.command === 'view' ? 'Reading' : args.command === 'create' ? 'Writing' : 'Editing'
    return `${verb} ${fname(args.path)}`
  }
  if (name === APPLY_PATCH_NAME) return 'Applying patch'
  if (name === 'shell_wait') return 'Waiting for background job'
  if (name === 'semantic_search' || name === 'codebase_search') return 'Searching codebase'
  if (name.startsWith('debug_')) return 'Debugging'
  if (name.startsWith('lsp_')) return 'Querying language server'
  if (name === 'run_checks') return 'Running project checks'
  if (name === 'spawn_agent' || name === 'parallel_agents') return 'Running subagents'
  if (name === 'web_search' || name === 'web_research') return 'Searching the web'
  if (name === 'research_report') return 'Compiling research report'
  if (name.startsWith('browser_')) return 'Navigating browser'
  if (tc.toolset === 'computer' || name === 'computer' || name.startsWith('computer_')) {
    const action = tc.toolset === 'computer' ? name : name === 'computer' ? String(args.action || '') : name.slice(9)
    return action === 'screenshot' || action === 'zoom' ? 'Looking at the screen' : `Using the computer (${action.replace(/_/g, ' ')})`
  }
  return `Running ${name}`
}

const DEFAULT_CONTEXT_WINDOW = 128_000

// --- Agent loop -------------------------------------------------------------

export async function checkSpendBudget(sessionId: string): Promise<string | null> {
  const { sessionBudgetUsd, dailyBudgetUsd } = usePrefsStore.getState()
  if (sessionBudgetUsd <= 0 && dailyBudgetUsd <= 0) return null
  const sessionCost = useUsageStore.getState().totalsFor(sessionId).cost
  if (sessionBudgetUsd > 0 && sessionCost >= sessionBudgetUsd) {
    useUsageStore.getState().noteDiagnostic(
      sessionId,
      'warn',
      i18n.t('chat.diagnostics.sessionBudget', {
        cost: sessionCost.toFixed(2),
        cap: sessionBudgetUsd.toFixed(2)
      })
    )
    return i18n.t('chat.errors.sessionBudgetHit', {
      cost: sessionCost.toFixed(2),
      cap: sessionBudgetUsd.toFixed(2)
    })
  }
  if (dailyBudgetUsd > 0 && window.api?.db?.getUsageSummary) {
    try {
      const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
      const rows = await window.api?.db?.getUsageSummary(startOfDay)
      const dayCost = (Array.isArray(rows) ? rows : []).reduce(
        (sum, r) => sum + (Number((r as { cost?: number }).cost) || 0),
        0
      )
      if (dayCost >= dailyBudgetUsd) {
        useUsageStore.getState().noteDiagnostic(
          sessionId,
          'warn',
          i18n.t('chat.diagnostics.dailyBudget', {
            cost: dayCost.toFixed(2),
            cap: dailyBudgetUsd.toFixed(2)
          })
        )
        return i18n.t('chat.errors.dailyBudgetHit', {
          cost: dayCost.toFixed(2),
          cap: dailyBudgetUsd.toFixed(2)
        })
      }
    } catch {
      /* accounting optional */
    }
  }
  return null
}

/** Plan items for the session, carried across compaction. */
export function currentPlanFor(sessionId: string): Array<{ content: string; status: string }> | undefined {
  try {
    const plan = usePlanStore.getState().getPlan(sessionId)
    return plan.length ? plan.map((p) => ({ content: p.content, status: p.status })) : undefined
  } catch {
    return undefined
  }
}

/** One-line "compacting context…" indicator on the live assistant area. */
export function setCompactingActivity(projectId: string, sessionId: string, on: boolean): void {
  try {
    const session = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)
    const last = session?.messages.filter((m) => m.role === 'assistant').pop()
    if (last) useStreamingStore.getState().setActivity(last.id, on ? i18n.t('chat.compacting') : null)
  } catch {
    /* cosmetic */
  }
}

/**
 * Manually compact the active session transcript (user-triggered).
 * Returns true if compaction ran.
 */
export async function compactSessionNow(sessionId: string): Promise<boolean> {
  if (!sessionId) return false
  try {
    const project = useAppStore
      .getState()
      .projects.find((p) => p.sessions.some((s) => s.id === sessionId))
    if (!project) return false
    const entries = await loadTranscript(project.id, sessionId)
    if (entries.length < 4) return false
    const before = estimateTokens(entries)
    const smart = await compactWithSummary(entries, {
      sessionId,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      plan: currentPlanFor(sessionId),
      useModel: useProviderStore.getState().smartCompaction
    }).catch(() => null)
    const next = smart?.compacted
      ? smart.entries
      : compactTranscript(entries, { keepEntries: 30, plan: currentPlanFor(sessionId) })
    const after = estimateTokens(next)
    if (after >= before * 0.95) {
      // Already compact — still refresh meter
      useUsageStore.getState().noteContext(sessionId, after, DEFAULT_CONTEXT_WINDOW, true)
      return false
    }
    persistTranscript(sessionId, next, '', undefined)
    void import('../agent/mods')
      .then(({ getModRuntime }) =>
        getModRuntime().emit('session.compact', { sessionId }, async (e) => e)
      )
      .catch(() => {})
    useUsageStore.getState().noteContext(sessionId, after, DEFAULT_CONTEXT_WINDOW, true)
    useUsageStore
      .getState()
      .noteDiagnostic(sessionId, 'info', i18n.t('chat.diagnostics.compactedManual'))
    return true
  } catch {
    return false
  }
}

/** Save a full tool output out of context; returns its id (or null). */
export async function offloadOutput(sessionId: string, content: string): Promise<string | null> {
  const save = window.api?.outputs?.save
  if (typeof save !== 'function') return null
  try {
    const r = await save(sessionId, content)
    return r.ok && r.id ? r.id : null
  } catch {
    return null
  }
}

/** Append agent-facing text to the round's last tool result (cache-friendly: no extra message). */
export function appendToLastToolResult(entries: TranscriptEntry[], text: string): void {
  const i = entries.length - 1
  const e = entries[i]
  if (e && e.role === 'tool') entries[i] = { ...e, content: `${e.content}\n\n${text}` }
}

export function lastAssistantText(projectId: string, sessionId: string): string {
  const session = useAppStore
    .getState()
    .projects.find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
  const last = session?.messages.filter((m) => m.role === 'assistant' && m.content.trim()).pop()
  return last?.content || ''
}

/**
 * Tag the last surviving assistant bubble of a turn with how long the agent
 * worked (empty tool-round placeholders are removed, so walk backwards).
 */
export function recordTurnDuration(
  projectId: string,
  sessionId: string,
  assistantIds: string[],
  durationMs: number
): void {
  if (assistantIds.length === 0 || durationMs <= 0) return
  try {
    const session = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const present = new Set(session.messages.map((m) => m.id))
    for (let i = assistantIds.length - 1; i >= 0; i--) {
      if (present.has(assistantIds[i])) {
        useAppStore.getState().updateMessageDuration(projectId, sessionId, assistantIds[i], durationMs)
        return
      }
    }
  } catch {
    /* cosmetic metadata — never break turn teardown */
  }
}
