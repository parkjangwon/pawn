import { callLLM } from './llm'
import { injectBackgroundResult } from './subagentReporting'
// Reporting helpers were split into subagentReporting.ts; the old path
// re-exports so the subagent facade and tool handlers keep working.
export { formatSubagentResults, listAgentCatalog } from './subagentReporting'
import { getConnectedProviders, hiddenToolNames } from './toolsets'
import { TOOLS as SUBAGENT_TOOLS } from './toolDefinitions'
import { executeTool } from './toolExecutor'
import { TOOL_SAFETY } from './toolPermission'
import { effectiveToolName } from './toolIdentity'
import {
  route,
  setSessionRoute,
  noteProviderFailure,
  noteProviderSuccess,
  providerFailureCount,
  type RouteDecision
} from './router'
import { effectiveCostMode, effectivePoolLimit, harnessProfile } from './harnessMode'
import { estimateTokens, type TranscriptEntry } from './transcript'
import type { ToolCall, ToolResult } from './toolDefinitionsTypes'
import { useUsageStore } from '../stores/usage'
import { useProviderStore } from '../stores/provider'
import {
  useSubagentRunsStore,
  registerSubagentController,
  registerSubagentResultPromise,
  type SubagentRun
} from '../stores/subagentRuns'
import { useAppStore } from '../stores/app'
import { uid } from '../utils/uid'
import {
  loadAgentProfiles,
  getBuiltinProfile,
  resolveProfileName,
  thoroughnessMaxRounds,
  thoroughnessHint,
  type AgentApplyMode
} from './agentProfiles'
import {
  applyBudget,
  checkSubagentToolCall,
  emptyToolBudget,
  nextPolicyBlockStreak,
  shouldEarlyStopPolicy,
  type ToolBudgetState
} from './subagentToolPolicy'
import {
  buildSiblingFindingsBlock,
  extractClaimsFromSummary,
  mergeTaskPrompt,
  partitionWaveByFailPolicy,
  planExecutionWaves,
  syntheticSkipResult,
  type DependencyFailPolicy
} from './subagentOrchestration'
import {
  accumulateUsage,
  buildSkillsPreloadBlock,
  buildSubagentPreamble,
  buildSystemLayers,
  compactSubagentSummary,
  complexityFromModelPref,
  emptyUsage,
  enterSubagent,
  leaveSubagent,
  mapPool,
  createAdaptiveLimit,
  HARD_MAX_ROUNDS,
  MAX_REPEATED_TOOL_ROUNDS,
  MAX_ROUTE_ATTEMPTS,
  normalizeParallelTasks,
  profileAllowEscalate,
  profileMaxTier,
  subagentStickySessionId,
  SUBAGENT_TOOL_RESULT_CAP,
  toolCallSignature
} from './subagentCore'
import { finalizeWorktree, maybeCreateWorktree } from './subagentWorktree'
import { releaseBrowserAgent } from './browser'
import type { SubagentIsolation, SubagentResult, SubagentTask } from './subagentTypes'

const SUBAGENT_STATIC_TOOL_NAMES = SUBAGENT_TOOLS.map((t) => t.name)

// --- Side-panel close debounce --------------------------------------------
//
// The browser panel auto-closes once all subagent browsing is done, but only
// if a subagent actually opened it (window.__subagentOpenedBrowserPanel). The
// close is debounced so a sequential pipeline (research planner → workers →
// synthesizer) doesn't close the panel between phases and flicker it back
// open: any new run cancels the pending close (see runSubagent's start).
const PANEL_CLOSE_DEBOUNCE_MS = 3000
let pendingPanelClose: ReturnType<typeof setTimeout> | null = null

function closePanelIfSubagentOpened(): void {
  const w = window as unknown as {
    __subagentOpenedBrowserPanel?: boolean
    __closeRightPanel?: () => void
  }
  if (w.__subagentOpenedBrowserPanel) {
    w.__subagentOpenedBrowserPanel = false
    try {
      w.__closeRightPanel?.()
    } catch {
      /* optional */
    }
  }
}

function armPanelClose(): void {
  if (pendingPanelClose) return
  pendingPanelClose = setTimeout(() => {
    pendingPanelClose = null
    closePanelIfSubagentOpened()
  }, PANEL_CLOSE_DEBOUNCE_MS)
}

function cancelPanelClose(): void {
  if (pendingPanelClose) {
    clearTimeout(pendingPanelClose)
    pendingPanelClose = null
  }
}

// --- Run loop + orchestration ----------------------------------------------


export async function runSubagent(
  task: SubagentTask,
  opts: {
    projectId: string
    sessionId: string
    projectPath?: string
    signal?: AbortSignal
    /** Pre-allocated run id (background spawn). */
    runId?: string
    background?: boolean
    batchId?: string
    /** Batch-wide brief + sibling findings (orchestration). */
    sharedContext?: string
    siblingFindings?: string
    /**
     * Resolve the profile from the builtin registry only, ignoring project/user
     * agent files. Used for the research synthesizer, whose input is untrusted
     * web content — a project agent file must never be able to widen its tool
     * surface (e.g. re-enabling shell).
     */
    forceBuiltinProfile?: boolean
  }
): Promise<SubagentResult> {
  const label = (task.name || 'subagent').slice(0, 80)
  const profiles = opts.forceBuiltinProfile ? [] : await loadAgentProfiles(opts.projectPath)
  const profileName = resolveProfileName(task.agent, task.mode)
  const profile =
    profiles.find((p) => p.name === profileName) ||
    getBuiltinProfile(profileName) ||
    getBuiltinProfile('explore')!

  const isolation: SubagentIsolation =
    task.isolation || profile.isolation || 'none'
  const apply: AgentApplyMode =
    task.apply || profile.apply || (isolation === 'worktree' ? 'auto' : 'none')
  const thoroughness = task.thoroughness || profile.thoroughness
  const maxRounds = thoroughnessMaxRounds(
    Math.min(
      HARD_MAX_ROUNDS,
      Math.max(1, Math.floor(task.maxRounds || profile.maxTurns || 12))
    ),
    thoroughness
  )
  const background = opts.background === true || task.background === true
  const batchId = opts.batchId || task.batchId
  const runId = opts.runId || uid('subrun-')
  // Sticky by project+profile (not run id): keeps router warm and avoids
  // re-priming the same explore/worker model every spawn. Parent chat sticky
  // stays isolated because the key is namespaced `subagent:…`.
  const subSessionId = subagentStickySessionId(opts.projectId, profile.name)

  if (!task.prompt?.trim()) {
    return {
      name: label,
      agent: profile.name,
      ok: false,
      summary: '',
      rounds: 0,
      toolsUsed: [],
      error: 'prompt is required',
      profileSource: profile.source,
      runId,
      background,
      batchId
    }
  }
  // Nesting is blocked at the tool-handler layer (ctx.subagent). Concurrent
  // siblings (parallel_agents / background) must not share a global depth cap.
  enterSubagent()
  const toolsUsed: string[] = []
  let rounds = 0

  // Own controller so cancel_agent works; also abort if parent signal fires
  // (foreground only — background outlives the parent tool call).
  const own = new AbortController()
  registerSubagentController(runId, own)
  if (opts.signal && !background) {
    if (opts.signal.aborted) own.abort()
    else {
      opts.signal.addEventListener('abort', () => own.abort(), { once: true })
    }
  }
  const signal = own.signal

  let worktreePath: string | undefined
  let worktreeBranch: string | undefined
  let toolCwd = opts.projectPath
  let lastSig: string | null = null
  let sigRepeats = 0
  const toolBudget: ToolBudgetState = emptyToolBudget()
  let policyBlockStreak = 0

  const userTaskBody = mergeTaskPrompt(task, {
    sharedContext: opts.sharedContext,
    siblingFindings: opts.siblingFindings
  })

  useSubagentRunsStore.getState().start({
    id: runId,
    name: label,
    agent: profile.name,
    mode: profile.name === 'worker' ? 'worker' : 'explore',
    parentSessionId: opts.sessionId,
    projectId: opts.projectId,
    background,
    isolation,
    worktreePath: undefined,
    maxRounds,
    batchId,
    promptPreview: task.prompt.trim().slice(0, 200),
    promptFull: task.prompt.trim()
  })
  // A new run supersedes any pending panel-close: a sequential pipeline moves
  // to its next phase (planner → workers → synthesizer) without flicker.
  cancelPanelClose()

  let terminal = false
  /**
   * Shared fail exit for the loop's five terminal cases: discard the worktree
   * without applying changes, then finish the run as failed.
   */
  const failFinish = async (error: string, summary = ''): Promise<SubagentResult> => {
    const fin = await finalizeWorktree({
      projectPath: opts.projectPath,
      worktreePath,
      worktreeBranch,
      apply: 'none',
      ok: false
    })
    worktreePath = undefined
    return finish({
      name: label,
      ok: false,
      summary,
      rounds,
      toolsUsed,
      error,
      isolation,
      filesChanged: fin.filesChanged,
      applied: false
    })
  }
  const finish = async (result: Omit<SubagentResult, 'agent' | 'profileSource'> & {
    agent?: string
  }): Promise<SubagentResult> => {
    const full: SubagentResult = {
      ...result,
      agent: profile.name,
      profileSource: profile.source,
      runId,
      background,
      batchId
    }
    useSubagentRunsStore.getState().finish(runId, {
      status: full.ok ? (signal.aborted ? 'aborted' : 'ok') : 'error',
      summary: full.summary,
      error: full.error,
      rounds: full.rounds,
      toolsUsed: full.toolsUsed,
      filesChanged: full.filesChanged,
      applied: full.applied,
      applyConflicts: full.applyConflicts,
      applyPending: full.applyPending,
      projectPath: full.projectPath || opts.projectPath,
      worktreePath: full.worktreePath,
      worktreeBranch: full.worktreeBranch,
      usage: full.usage
    })
    terminal = true
    return full
  }

  try {
    const wt = await maybeCreateWorktree(opts.projectPath, runId, isolation)
    toolCwd = wt.cwd || opts.projectPath
    worktreePath = wt.worktreePath
    worktreeBranch = wt.branch
    if (worktreePath) {
      useSubagentRunsStore.setState((s) => ({
        runs: s.runs.map((r) =>
          r.id === runId ? { ...r, worktreePath, isolation: 'worktree' } : r
        )
      }))
    }

    const modelPref = task.model || profile.model || 'inherit'
    const complexity = complexityFromModelPref(modelPref, task.prompt)
    const providerState = useProviderStore.getState()
    // Subagents run under a sub-session id; the harness mode is the parent's.
    const parentHarnessMode = providerState.harnessModeFor?.(opts.sessionId) ?? 'default'
    const costMode = effectiveCostMode(providerState.subagentCostMode || 'balanced', parentHarnessMode)
    const maxTier = profileMaxTier(profile.name, modelPref, costMode)
    const allowEscalate = profileAllowEscalate(maxTier, costMode)
    const runUsage = emptyUsage()
    // Byte-stable system layers → Anthropic cache_control + DeepSeek disk hits
    // across multi-round tool loops (and sequential runs of the same profile).
    const systemLayers = buildSystemLayers(profile)
    // Fold per-run context into the *user* turn — never into system — so OpenAI/
    // DeepSeek see a single stable system message (disk KV) and Claude can still
    // cache system blocks without task-label churn.
    const runContext = buildSubagentPreamble({
      toolCwd,
      projectPath: opts.projectPath,
      isolation,
      thoroughness: thoroughnessHint(thoroughness),
      taskName: label,
      worktreeNote: wt.note
    })
    // Profile-declared skills load into the user turn (cache-safe for system).
    const skillsBlock = await buildSkillsPreloadBlock(opts.projectPath, profile.skills)
    // Keep empty: project CLAUDE.md/skills catalog stays on the parent to avoid
    // re-priming every subagent with a large unstable system suffix.
    const projectPreamble = ''

    let entries: TranscriptEntry[] = [
      {
        role: 'user',
        content:
          `${runContext}` +
          (skillsBlock ? `\n\n${skillsBlock}` : '') +
          `\n\n${userTaskBody}`
      }
    ]

    while (rounds < maxRounds) {
      if (signal.aborted) return await failFinish('aborted', 'Aborted')
      rounds++
      useSubagentRunsStore.getState().tick(runId, { rounds, toolsUsed: [...toolsUsed] })

      const excluded = new Set<string>()
      let result: Awaited<ReturnType<typeof callLLM>> | null = null
      let decision: RouteDecision | null = null
      let lastErr = ''

      for (let attempt = 0; attempt < MAX_ROUTE_ATTEMPTS; attempt++) {
        if (signal.aborted) break
        decision = route({
          sessionId: subSessionId,
          entries,
          complexity,
          escalate: allowEscalate && attempt >= 2 ? 1 : 0,
          exclude: excluded,
          newTurn: rounds === 1 && attempt === 0,
          needsVision: false,
          maxTier,
          harnessMode: parentHarnessMode
        })
        if (!decision) break

        const assistantMsgId = `sub-${runId}-${rounds}-${attempt}`
        try {
          result = await callLLM({
            decision,
            entries,
            systemLayers,
            projectPreamble,
            sessionId: subSessionId,
            projectId: opts.projectId,
            // Prefer project root for MCP catalog stability (cacheable tool list);
            // file tools still execute with toolCwd via executeTool below.
            projectPath: opts.projectPath || toolCwd,
            assistantMsgId,
            signal,
            complexity,
            toolAllowlist: profile.tools,
            toolDenylist: [
              ...(profile.disallowedTools || []),
              ...hiddenToolNames({
                entries,
                allToolNames: SUBAGENT_STATIC_TOOL_NAMES,
                connected: getConnectedProviders(),
                mode: useProviderStore.getState().toolLoading
              })
            ],
            harnessMode: parentHarnessMode
          })
          noteProviderSuccess(decision.provider.id)
          if (!decision.ephemeral) {
            // warmTokens ≈ prompt size so router prices next round as cache-hot.
            setSessionRoute(subSessionId, decision.key, decision.tier, estimateTokens(entries))
          }
          // Bill under parent session for the usage panel; sticky uses subSessionId.
          useUsageStore.getState().record(opts.sessionId, decision.model, result.usage)
          accumulateUsage(runUsage, decision.model, result.usage)
          useSubagentRunsStore.getState().tick(runId, {
            rounds,
            toolsUsed: [...toolsUsed],
            usage: { ...runUsage }
          })
          break
        } catch (err) {
          lastErr = String(err)
          result = null
          if (signal.aborted) break
          if ((err as { transient?: boolean }).transient !== false) {
            noteProviderFailure(decision.provider.id)
          }
          excluded.add(decision.key)
          if (attempt === MAX_ROUTE_ATTEMPTS - 1) return await failFinish(lastErr || 'All model attempts failed')
        }
      }

      if (!decision || !result) return await failFinish(lastErr || 'No model available to run subagent')

      entries.push({
        role: 'assistant',
        content: result.text,
        ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
        ...(result.reasoningContent != null ? { reasoningContent: result.reasoningContent } : {})
      })

      if (!result.toolCalls.length) {
        let rawSummary = (result.text || '').trim() || '(no summary)'
        if (worktreePath && window.api?.worktree?.diffStat) {
          const diff = await window.api.worktree.diffStat(worktreePath)
          if (diff && diff.length < 2000) rawSummary += `\n\n### Worktree diff\n${diff}`
        }
        const fin = await finalizeWorktree({
          projectPath: opts.projectPath,
          worktreePath,
          worktreeBranch,
          apply,
          ok: true
        })
        if (fin.applyNote) rawSummary += `\n\n### Apply\n${fin.applyNote}`
        const heldWt = fin.keepWorktree ? worktreePath : undefined
        const heldBr = fin.keepWorktree ? worktreeBranch : undefined
        worktreePath = undefined
        const summary = compactSubagentSummary(rawSummary, {
          agent: profile.name,
          filesChanged: fin.filesChanged,
          applied: fin.applied,
          applyConflicts: fin.applyConflicts,
          applyNote: fin.applyNote,
          usage: runUsage,
          toolsUsed
        })
        return finish({
          name: label,
          ok: true,
          summary,
          rounds,
          toolsUsed,
          isolation,
          filesChanged: fin.filesChanged,
          applied: fin.applied,
          applyConflicts: fin.applyConflicts,
          applyNote: fin.applyNote,
          applyPending: fin.applyPending,
          projectPath: opts.projectPath,
          worktreePath: heldWt,
          worktreeBranch: heldBr,
          usage: { ...runUsage }
        })
      }

      // Tool loop detection
      const sig = toolCallSignature(result.toolCalls)
      if (sig && sig === lastSig) {
        sigRepeats++
        if (sigRepeats >= MAX_REPEATED_TOOL_ROUNDS) {
          return await failFinish(
            `Tool loop detected (same calls ×${MAX_REPEATED_TOOL_ROUNDS})`,
            result.text || ''
          )
        }
      } else {
        lastSig = sig
        sigRepeats = 1
      }

      const safe: ToolCall[] = []
      const risky: ToolCall[] = []
      const blocked = new Map<string, string>()
      for (const tc of result.toolCalls) {
        const decision = checkSubagentToolCall(tc, profile, toolBudget, {
          projectPath: opts.projectPath
        })
        if (!decision.allowed) {
          blocked.set(tc.id, decision.reason || `Blocked: ${tc.name}`)
          continue
        }
        applyBudget(toolBudget, decision)
        ;(TOOL_SAFETY[effectiveToolName(tc)] === 'safe' ? safe : risky).push(tc)
      }

      policyBlockStreak = nextPolicyBlockStreak(policyBlockStreak, {
        totalCalls: result.toolCalls.length,
        blockedCount: blocked.size,
        anyAllowed: safe.length + risky.length > 0
      })

      const resultsById = new Map<string, ToolResult>()
      for (const [id, reason] of blocked) {
        resultsById.set(id, {
          toolCallId: id,
          content: `${reason}\n(Adapt: do not retry the same blocked call.)`,
          isError: true
        })
      }
      if (safe.length && !signal.aborted) {
        const settled = await Promise.all(
          safe.map((tc) =>
            executeTool(tc, toolCwd, signal, {
              sessionId: opts.sessionId,
              projectId: opts.projectId,
              subagent: true,
              subagentRunId: runId
            })
          )
        )
        safe.forEach((tc, i) => resultsById.set(tc.id, settled[i]))
      }
      for (const tc of risky) {
        if (signal.aborted) break
        resultsById.set(
          tc.id,
          await executeTool(tc, toolCwd, signal, {
            sessionId: opts.sessionId,
            projectId: opts.projectId,
            subagent: true,
            subagentRunId: runId
          })
        )
      }

      const lastTool = result.toolCalls[result.toolCalls.length - 1]?.name
      for (const tc of result.toolCalls) {
        toolsUsed.push(tc.name)
        const raw = resultsById.get(tc.id) || {
          toolCallId: tc.id,
          content: 'No result',
          isError: true
        }
        entries.push({
          role: 'tool',
          toolCallId: tc.id,
          name: tc.name,
          content: String(raw.content || '').slice(0, SUBAGENT_TOOL_RESULT_CAP),
          isError: raw.isError === true
        })
      }
      useSubagentRunsStore.getState().tick(runId, {
        rounds,
        toolsUsed: [...toolsUsed],
        lastTool,
        maxRounds,
        usage: { ...runUsage }
      })

      // Early stop: budget dead or repeated full-block rounds (save tokens).
      const early = shouldEarlyStopPolicy({
        streak: policyBlockStreak,
        blockedReasons: [...blocked.values()]
      })
      if (early.stop && safe.length === 0 && risky.length === 0) {
        const fin = await finalizeWorktree({
          projectPath: opts.projectPath,
          worktreePath,
          worktreeBranch,
          apply: 'none',
          ok: false
        })
        worktreePath = undefined
        const summary = compactSubagentSummary(
          `Stopped by subagent policy: ${early.reason}\n\nPartial work may be incomplete.`,
          {
            agent: profile.name,
            filesChanged: fin.filesChanged,
            applied: false,
            usage: runUsage,
            toolsUsed
          }
        )
        return finish({
          name: label,
          ok: false,
          summary,
          rounds,
          toolsUsed,
          error: early.reason,
          isolation,
          filesChanged: fin.filesChanged,
          applied: false,
          usage: { ...runUsage }
        })
      }
    }

    const lastAssistant = [...entries].reverse().find((e) => e.role === 'assistant')
    let rawSummary =
      (lastAssistant && 'content' in lastAssistant ? String(lastAssistant.content || '') : '') ||
      `Hit max rounds (${maxRounds}) without a final answer.`
    if (worktreePath && window.api?.worktree?.diffStat) {
      const diff = await window.api.worktree.diffStat(worktreePath)
      if (diff && diff.length < 2000) rawSummary += `\n\n### Worktree diff\n${diff}`
    }
    const fin = await finalizeWorktree({
      projectPath: opts.projectPath,
      worktreePath,
      worktreeBranch,
      apply,
      ok: true
    })
    if (fin.applyNote) rawSummary += `\n\n### Apply\n${fin.applyNote}`
    const heldWt = fin.keepWorktree ? worktreePath : undefined
    const heldBr = fin.keepWorktree ? worktreeBranch : undefined
    worktreePath = undefined
    const summary = compactSubagentSummary(rawSummary, {
      agent: profile.name,
      filesChanged: fin.filesChanged,
      applied: fin.applied,
      applyConflicts: fin.applyConflicts,
      applyNote: fin.applyNote,
      usage: runUsage,
      toolsUsed
    })
    return finish({
      name: label,
      ok: true,
      summary,
      rounds,
      toolsUsed,
      error: `max_rounds=${maxRounds}`,
      isolation,
      filesChanged: fin.filesChanged,
      applied: fin.applied,
      applyConflicts: fin.applyConflicts,
      applyNote: fin.applyNote,
      applyPending: fin.applyPending,
      projectPath: opts.projectPath,
      worktreePath: heldWt,
      worktreeBranch: heldBr,
      usage: { ...runUsage }
    })
  } catch (err) {
    // The loop's own error paths call finish() above; this catches anything
    // that escapes them so the run always goes terminal. Without it, an
    // unexpected error left a phantom 'running' entry forever — pinning the
    // Agents panel, blocking the subagent-close panel logic, and never
    // clearing activeForSession. If a finish already recorded a terminal
    // state, don't overwrite it — just propagate so the finally still runs.
    if (terminal) throw err
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`runSubagent ${runId} crashed:`, err)
    return finish({
      name: label,
      ok: false,
      summary: `runSubagent crashed: ${msg}`,
      error: msg,
      rounds,
      toolsUsed,
      isolation,
      projectPath: opts.projectPath,
      worktreePath,
      worktreeBranch,
      usage: emptyUsage()
    })
  } finally {
    leaveSubagent()
    // Return this run's browser tabs to the pool (parallel browsing): closing
    // them frees the MAX_TABS budget and renderer processes when the run ends.
    if (window.api?.browser?.releaseOwner) {
      void window.api.browser.releaseOwner(`subagent:${runId}`).catch(() => {})
    }
    // Drop the run's bound agent so per-run closures do not accumulate.
    try {
      releaseBrowserAgent(`subagent:${runId}`)
    } catch {
      /* optional */
    }
    // Subagent browsing is done (no other run is still active): arm a short
    // debounce before closing the side panel. Sequential pipelines
    // (research planner → workers → synthesizer) end one run and start the
    // next almost immediately; without the debounce the panel would close
    // between phases and then flicker back open. Any new run cancels it
    // (cancelPanelClose in runSubagent's start). The close stays
    // marker-gated: a panel the user opened or is viewing is never touched.
    if (!useSubagentRunsStore.getState().runs.some((r) => r.status === 'running')) {
      armPanelClose()
    }
    // Safety net if we exited without finalizeWorktree clearing the path.
    if (worktreePath && opts.projectPath && window.api?.worktree?.remove) {
      void window.api.worktree.remove(opts.projectPath, worktreePath, worktreeBranch).catch(() => {})
    }
  }
}

export async function runParallelSubagents(
  tasks: SubagentTask[],
  opts: {
    projectId: string
    sessionId: string
    projectPath?: string
    signal?: AbortSignal
    /** Shared brief injected into every task (untrusted coordination data). */
    sharedContext?: string
    /**
     * When a dependency fails:
     * - skip (default): do not run dependents
     * - continue: still run dependents with sibling findings
     * - stop: skip all remaining waves after a failure
     */
    onDependencyFail?: DependencyFailPolicy
  }
): Promise<SubagentResult[]> {
  const batchId = uid('batch-')
  const failPolicy: DependencyFailPolicy = opts.onDependencyFail || 'skip'
  const providerState = useProviderStore.getState()
  const harnessMode = providerState.harnessModeFor?.(opts.sessionId) ?? 'default'
  const harness = harnessProfile(harnessMode)
  const capped = normalizeParallelTasks(tasks, harness.maxParallelTasks).map((t, i) => ({
    ...t,
    batchId,
    // Stable names for depends_on when omitted
    name: t.name || `task-${i + 1}`
  }))
  const poolLimit = effectivePoolLimit(providerState.maxParallelSubagents || 4, harnessMode)
  // Wide pools (maxing) back off on 429/5xx instead of retrying in lockstep.
  const dynamicLimit = poolLimit > 6 ? createAdaptiveLimit(poolLimit, providerFailureCount) : undefined
  const shared = (opts.sharedContext || '').trim()

  // Background: no depends_on (fire-and-forget). Tasks with both bg+deps run as FG.
  const bg = capped.filter((t) => t.background && !(t.dependsOn && t.dependsOn.length))
  const fg = capped.filter((t) => !t.background || (t.dependsOn && t.dependsOn.length))

  const bgHandles = bg.map((t) =>
    spawnBackgroundSubagent(
      { ...t, background: true, sharedContext: t.sharedContext || shared || undefined },
      {
        projectId: opts.projectId,
        sessionId: opts.sessionId,
        projectPath: opts.projectPath,
        batchId
      }
    )
  )

  // Foreground: DAG waves → within each wave, bounded parallel pool.
  const { waves, cycleWarning } = planExecutionWaves(fg)
  const fgResults: SubagentResult[] = []
  const completed: SubagentResult[] = []
  const failedNames = new Set<string>()
  let stopped = false

  for (let wi = 0; wi < waves.length; wi++) {
    if (stopped) {
      for (const t of waves[wi]) {
        const r = syntheticSkipResult(
          t,
          `Skipped: earlier wave failed [policy=stop]`,
          batchId
        )
        fgResults.push(r)
        completed.push(r)
      }
      continue
    }

    const wave = waves[wi]
    const { run, skip } = partitionWaveByFailPolicy(wave, failedNames, failPolicy)
    for (const s of skip) {
      const r = syntheticSkipResult(s.task, s.reason, batchId)
      fgResults.push(r)
      completed.push(r)
      const n = (s.task.name || '').trim()
      if (n) failedNames.add(n)
    }

    if (!run.length) continue

    const siblingFindings =
      wi > 0 || completed.length ? buildSiblingFindingsBlock(completed) : undefined
    // Only inject siblings for waves after first content exists
    const findings = wi > 0 ? siblingFindings : undefined

    const waveResults = await mapPool(run, poolLimit, (t) =>
      runSubagent(
        { ...t, background: false, sharedContext: t.sharedContext || shared || undefined },
        {
          ...opts,
          batchId,
          sharedContext: shared || undefined,
          siblingFindings: findings
        }
      ),
      dynamicLimit ? { dynamicLimit } : undefined
    )
    for (const r of waveResults) {
      fgResults.push(r)
      completed.push(r)
      if (!r.ok) {
        const n = (r.name || '').trim()
        if (n) failedNames.add(n)
      }
    }

    if (failPolicy === 'stop' && waveResults.some((r) => !r.ok)) {
      stopped = true
    }
  }

  const out: SubagentResult[] = [
    ...fgResults,
    ...bgHandles.map((h) => ({
      name: h.name,
      agent: h.agent,
      ok: true,
      summary:
        `Background run started (id=${h.runId}, batch=${batchId}). ` +
        `Use await_agent id="${h.runId}" or await_agent id="*" for all session runs.`,
      rounds: 0,
      toolsUsed: [],
      runId: h.runId,
      background: true,
      batchId
    }))
  ]
  if (cycleWarning && out[0]) {
    out[0] = {
      ...out[0],
      summary: `note: ${cycleWarning}\n\n${out[0].summary || ''}`
    }
  }
  return out
}

export function spawnBackgroundSubagent(
  task: SubagentTask,
  opts: {
    projectId: string
    sessionId: string
    projectPath?: string
    batchId?: string
  }
): { runId: string; name: string; agent: string; batchId?: string } {
  const runId = uid('subrun-')
  const name = (task.name || 'subagent').slice(0, 80)
  const agent = resolveProfileName(task.agent, task.mode)
  const batchId = opts.batchId || task.batchId
  const promise = runSubagent(
    { ...task, background: true, batchId },
    {
      ...opts,
      runId,
      background: true,
      batchId
    }
  ).then((result) => {
    injectBackgroundResult(opts.projectId, opts.sessionId, result)
    const run = useSubagentRunsStore.getState().getById(runId)
    return (
      run ||
      ({
        id: runId,
        name: result.name,
        agent: result.agent,
        mode: result.agent === 'worker' ? 'worker' : 'explore',
        status: result.ok ? 'ok' : 'error',
        parentSessionId: opts.sessionId,
        background: true,
        batchId,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        rounds: result.rounds,
        toolsUsed: result.toolsUsed,
        summary: result.summary,
        error: result.error
      } as SubagentRun)
    )
  })
  registerSubagentResultPromise(runId, promise)
  return { runId, name, agent, batchId }
}


