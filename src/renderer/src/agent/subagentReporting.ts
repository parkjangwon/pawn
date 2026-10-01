/**
 * Subagent result reporting: transcript formatting, the background-result
 * injection, and the agent catalog projection. Leaf helpers split out of
 * subagentRun.ts (the old path re-exports them).
 */

import { loadAgentProfiles } from './agentProfiles'
import { extractClaimsFromSummary } from './subagentOrchestration'
import type { SubagentResult } from './subagentTypes'
import { useAppStore } from '../stores/app'

export function formatSubagentResults(results: SubagentResult[]): string {
  const lines: string[] = [`# Subagent results (${results.length})`, '']
  let totalCost = 0
  let totalCacheRead = 0
  let totalPrompt = 0
  for (const r of results) {
    lines.push(
      `## ${r.name} [${r.agent || '?'}] — ${r.ok ? 'ok' : 'FAIL'}` +
        ` (rounds=${r.rounds}${r.isolation ? `, ${r.isolation}` : ''}` +
        `${r.applied ? ', applied' : ''}` +
        `${r.background ? ', bg' : ''})`
    )
    if (r.profileSource && r.profileSource !== 'builtin') {
      lines.push(`source: ${r.profileSource}`)
    }
    if (r.usage && r.usage.calls > 0) {
      totalCost += r.usage.cost
      totalCacheRead += r.usage.cacheReadTokens
      totalPrompt += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens
      lines.push(
        `usage: $${r.usage.cost.toFixed(4)} · cache ${(r.usage.cacheHitRate * 100).toFixed(0)}%` +
          (r.usage.modelLabel ? ` · ${r.usage.modelLabel}` : '')
      )
    }
    if (r.applyConflicts?.length) {
      lines.push(`conflicts: ${r.applyConflicts.slice(0, 12).join(', ')}`)
    }
    if (r.error) lines.push(`note: ${r.error}`)
    // Structured claims for parent reuse (cheap, stable)
    const claims = extractClaimsFromSummary(r.summary || '', 5)
    if (claims.length) {
      lines.push('claims: ' + claims.map((c) => c.slice(0, 120)).join(' | '))
    }
    lines.push('')
    // summary already compact + structured
    lines.push(r.summary || '(empty)')
    lines.push('')
  }
  if (results.length > 1 && totalPrompt > 0) {
    lines.push(
      `---\n**Total** $${totalCost.toFixed(4)} · cache ${((totalCacheRead / totalPrompt) * 100).toFixed(0)}%`
    )
  }
  // Hard cap: never flood the parent transcript (cache write tax).
  return lines.join('\n').slice(0, 24_000)
}

export function injectBackgroundResult(
  projectId: string,
  sessionId: string,
  result: SubagentResult
): void {
  try {
    const status = result.ok ? 'OK' : 'FAIL'
    const body =
      `[background subagent ${status}] ${result.name} [${result.agent}]` +
      (result.runId ? ` id=${result.runId}` : '') +
      `\n${formatSubagentResults([result]).slice(0, 12_000)}`
    useAppStore.getState().addMessage(projectId, sessionId, {
      id: `${Date.now()}-bgsub-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      content: body,
      createdAt: Date.now()
    })
    if (useAppStore.getState().activeSessionId === sessionId && !document.hasFocus()) {
      void window.api.notification
        ?.send?.(
          'Pawn',
          result.ok
            ? `Subagent ${result.name} finished`
            : `Subagent ${result.name} failed`
        )
        .catch(() => {})
    }
  } catch {
    /* non-fatal */
  }
}

export async function listAgentCatalog(projectPath?: string): Promise<
  Array<{
    name: string
    description: string
    source: string
    isolation: string
    model: string
    maxTurns: number
    skills?: string[]
    pathAllow?: string[]
    pathDeny?: string[]
    maxEdits?: number
    maxShell?: number
    maxToolCalls?: number
  }>
> {
  const profiles = await loadAgentProfiles(projectPath)
  return profiles.map((p) => ({
    name: p.name,
    description: p.description,
    source: p.source,
    isolation: p.isolation,
    model: p.model,
    maxTurns: p.maxTurns,
    skills: p.skills,
    pathAllow: p.pathAllow,
    pathDeny: p.pathDeny,
    maxEdits: p.maxEdits,
    maxShell: p.maxShell,
    maxToolCalls: p.maxToolCalls
  }))
}
