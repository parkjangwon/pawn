import { getBrowserAgent, type BrowserAgent } from '../browser'
import type { ToolExecContext } from './types'

/**
 * Owner key for a tool execution context — the tab the browser tools act on:
 * - subagent run  → `subagent:<runId>` (its own parked tab, parallel-safe)
 * - chat session  → `session:<sessionId>` (drives the visible tab)
 * - otherwise     → undefined (visible tab / legacy)
 */
export function browserOwnerKey(ctx?: ToolExecContext): string | undefined {
  if (!ctx) return undefined
  if (ctx.subagent && ctx.subagentRunId) return `subagent:${ctx.subagentRunId}`
  if (ctx.sessionId) return `session:${ctx.sessionId}`
  return undefined
}

export async function requireBrowser(
  ctx?: ToolExecContext
): Promise<{ agent: BrowserAgent } | { error: string }> {
  const agent = getBrowserAgent(browserOwnerKey(ctx))
  if (!agent) {
    return { error: 'The embedded browser is only available in the desktop app.' }
  }
  const ready = await agent.ensure()
  if (ready.error) return { error: ready.error }
  try {
    ;(window as any).__openRightPanelTab?.('browser', {
      subagent: browserOwnerKey(ctx)?.startsWith('subagent:') === true
    })
  } catch {
    // No panel bridge (e.g. dev:web)
  }
  return { agent }
}
