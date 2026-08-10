/**
 * Nested agent runner for spawn_agent / parallel_agents / list_agents.
 *
 * Claude-Code-inspired: specialized profiles (explore/plan/worker/code-reviewer
 * + custom markdown agents), isolated context, optional worktree with apply-back
 * to the main tree, model-tier hints, tool allow/deny, loop guards, retries.
 *
 * This module is now a thin facade: implementation lives in subagentTypes /
 * subagentCore / subagentWorktree / subagentRun so external import sites and
 * tests keep importing from '../subagent'.
 */

export type {
  SubagentMode,
  SubagentIsolation,
  SubagentTask,
  SubagentUsageStats,
  SubagentResult
} from './subagentTypes'

export {
  MAX_PARALLEL_SUBAGENTS,
  SUBAGENT_SUMMARY_CAP,
  SUBAGENT_TOOL_RESULT_CAP,
  buildSkillsPreloadBlock,
  buildSubagentPreamble,
  buildSystemLayers,
  compactSubagentSummary,
  getSubagentDepth,
  isSubagentToolAllowed,
  mapPool,
  normalizeParallelTasks,
  normalizeSubagentTask,
  profileAllowEscalate,
  profileMaxTier,
  subagentStickySessionId
} from './subagentCore'

export { applyPendingWorktree, discardPendingWorktree } from './subagentWorktree'

export {
  formatSubagentResults,
  listAgentCatalog,
  runParallelSubagents,
  runSubagent,
  spawnBackgroundSubagent
} from './subagentRun'

/** Re-export policy helpers for tests / UI. */
export {
  checkSubagentToolCall,
  matchPathGlob,
  emptyToolBudget,
  MAX_CONSECUTIVE_POLICY_BLOCKS,
  shouldEarlyStopPolicy,
  nextPolicyBlockStreak
} from './subagentToolPolicy'
export {
  planExecutionWaves,
  buildSiblingFindingsBlock,
  mergeTaskPrompt,
  extractClaimsFromSummary,
  toStructuredFinding,
  partitionWaveByFailPolicy,
  syntheticSkipResult,
  type DependencyFailPolicy
} from './subagentOrchestration'
