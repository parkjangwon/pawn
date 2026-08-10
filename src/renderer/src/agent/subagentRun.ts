import { callLLM } from './llm'
import { executeTool } from './toolExecutor'
import { TOOL_SAFETY } from './toolPermission'
import {
  route,
  setSessionRoute,
  noteProviderFailure,
  noteProviderSuccess,
  type RouteDecision
} from './router'
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
  maybeOpenAgentsPanel,
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
import type { SubagentIsolation, SubagentResult, SubagentTask } from './subagentTypes'

// --- Run loop + orchestration ----------------------------------------------

function injectBackgroundResult(
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
  }
): Promise<SubagentResult> {
  const label = (task.name || 'subagent').slice(0, 80)
  const profiles = await loadAgentProfiles(opts.projectPath)
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
    const costMode = useProviderStore.getState().subagentCostMode || 'balanced'
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
      if (signal.aborted) {
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
          summary: 'Aborted',
          rounds,
          toolsUsed,
          error: 'aborted',
          isolation,
          worktreePath: fin.filesChanged.length ? undefined : undefined,
          filesChanged: fin.filesChanged,
          applied: false
        })
      }
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
          maxTier
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
            toolDenylist: profile.disallowedTools
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
          if (attempt === MAX_ROUTE_ATTEMPTS - 1) {
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
              summary: '',
              rounds,
              toolsUsed,
              error: lastErr || 'All model attempts failed',
              isolation,
              filesChanged: fin.filesChanged,
              applied: false
            })
          }
        }
      }

      if (!decision || !result) {
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
          summary: '',
          rounds,
          toolsUsed,
          error: lastErr || 'No model available to run subagent',
          isolation,
          filesChanged: fin.filesChanged,
          applied: false
        })
      }

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
            summary: result.text || '',
            rounds,
            toolsUsed,
            error: `Tool loop detected (same calls ×${MAX_REPEATED_TOOL_ROUNDS})`,
            isolation,
            filesChanged: fin.filesChanged,
            applied: false
          })
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
        ;(TOOL_SAFETY[tc.name] === 'safe' ? safe : risky).push(tc)
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
              subagent: true
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
            subagent: true
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
  } finally {
    leaveSubagent()
    // Safety net if we exited without finalizeWorktree clearing the path.
    if (worktreePath && opts.projectPath && window.api?.worktree?.remove) {
      void window.api.worktree.remove(opts.projectPath, worktreePath, worktreeBranch)
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
  const capped = normalizeParallelTasks(tasks).map((t, i) => ({
    ...t,
    batchId,
    // Stable names for depends_on when omitted
    name: t.name || `task-${i + 1}`
  }))
  if (capped.length > 1 || capped.some((t) => t.background)) {
    maybeOpenAgentsPanel()
  }
  const poolLimit = useProviderStore.getState().maxParallelSubagents || 4
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
      )
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
  maybeOpenAgentsPanel()
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

