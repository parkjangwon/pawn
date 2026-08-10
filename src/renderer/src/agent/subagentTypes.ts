import type { AgentApplyMode, AgentIsolation, AgentThoroughness } from './agentProfiles'

/**
 * Shared types for the nested agent runner (spawn_agent / parallel_agents /
 * list_agents). Extracted from subagent.ts so the run loop, profile helpers,
 * and worktree logic can import types without pulling in each other's runtime.
 */

/** @deprecated Prefer profile names via `agent`. Kept for tool-call compat. */
export type SubagentMode = 'explore' | 'worker'
export type SubagentIsolation = AgentIsolation

export type SubagentTask = {
  name?: string
  prompt: string
  /** Profile name: explore | plan | worker | code-reviewer | custom */
  agent?: string
  /** Legacy: explore | worker — mapped to profiles when `agent` omitted. */
  mode?: SubagentMode | string
  maxRounds?: number
  isolation?: SubagentIsolation
  /** auto (default for worktree workers) | none */
  apply?: AgentApplyMode
  thoroughness?: AgentThoroughness
  /** Override profile model: inherit | simple | mid | complex | model id */
  model?: string
  /** When true, parent turn continues immediately; result lands as a system message. */
  background?: boolean
  /** Groups parallel fan-out for UI + await batch. */
  batchId?: string
  /**
   * Names of sibling tasks in the same parallel_agents call that must finish first.
   * Enables lightweight DAG waves (explore → worker) without nested spawn.
   */
  dependsOn?: string[]
  /** Extra shared brief for this task (also set batch-wide via parallel opts). */
  sharedContext?: string
}

export type SubagentUsageStats = {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  /** cacheRead / (cacheRead + input + cacheWrite) */
  cacheHitRate: number
  modelLabel?: string
}

export type SubagentResult = {
  name: string
  agent: string
  ok: boolean
  summary: string
  rounds: number
  toolsUsed: string[]
  filesChanged?: string[]
  applied?: boolean
  /** Paths where main tree had diverged edits overwritten by apply. */
  applyConflicts?: string[]
  applyNote?: string
  applyPending?: boolean
  error?: string
  isolation?: SubagentIsolation
  worktreePath?: string
  worktreeBranch?: string
  projectPath?: string
  profileSource?: string
  /** Registry id (for await_agent / cancel_agent). */
  runId?: string
  background?: boolean
  batchId?: string
  usage?: SubagentUsageStats
}
