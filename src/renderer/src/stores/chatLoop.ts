import {
  acquireSleepHold, autoTitle, bumpSessionEpoch, getSessionEpoch, releaseSleepHold,
  sessionControllers, setSessionStreamingFlags, type ChatGet, type ChatSet
} from './chatState'
import {
  appendToLastToolResult,
  checkSpendBudget,
  compactSessionNow,
  currentPlanFor,
  describeToolAction,
  lastAssistantText,
  offloadOutput,
  recordTurnDuration,
  setCompactingActivity
} from './chatTurnHelpers'

// Leaf turn helpers were split into chatTurnHelpers.ts; re-export the public
// surface so the chat facade and other importers keep working.
export { compactSessionNow, describeToolAction, recordTurnDuration } from './chatTurnHelpers'
import {
  checkpointSnapshot, classifyLlmError, currentMessageContent, demoteVisionPayloadsToText, loadTranscript,
  persistTranscript, systemError, ToolLoopCounter, toolResultCap, truncateToolResult
} from './chatTranscript'
import type { MessageErrorInfo } from './app'
import { useAppStore } from './app'
import { useChangeLedger } from './changeLedger'
import { usePrefsStore } from './prefs'
import { useProviderStore } from './provider'
import { useRoutineStore } from './routine'
import { useUsageStore } from './usage'
import { clearTurnCheckpoint, type AgentTurnCheckpoint } from './turnCheckpoint'
import { executeTool, TOOL_SAFETY, type ToolCall, type ToolResult } from '../agent/tools'
import { NEEDS_APPROVAL_IN_AUTO } from '../agent/toolPermission'
import { effectiveToolName } from '../agent/toolIdentity'
import { APPLY_PATCH_NAME, BASH_NAME, TEXT_EDITOR_NAME, isFileMutation } from '../agent/nativeTools'
import { clearOldToolResults } from '../agent/contextEditing'
import { hydrateNotes, getNotes } from '../agent/workingNotes'
import { StuckDetector, stuckDigest } from '../agent/stuckRecovery'
import { requestSecondOpinion } from '../agent/secondOpinion'
import { collectRuntimeEvents } from '../agent/runtimeWatch'
import { formatPrefetched, prefetchMentionedFiles } from '../agent/mentionPrefetch'
import { noteFileSeen, snapshotScope } from '../agent/fileSnapshots'
import { formatProfileBlock, learnFromCommand, loadProfile } from '../agent/repoProfile'
import { detectCorrection, takeRecentRevert } from '../agent/correctionLearning'
import { learnFromCorrection } from '../agent/learning'
import { generalWorkspaceDir } from '../utils/generalWorkspace'
import { recordCommandCreatedFiles, takeFileBaseline } from '../agent/commandFiles'
import { runProjectChecks } from '../agent/runChecks'
import { targetSandboxOpts } from '../agent/executionTarget'
import { loadProjectContext, buildProjectContextBlock } from '../agent/skills'
import {
  route, estimateComplexity, shouldEscalate, setSessionRoute,
  noteProviderFailure, noteProviderSuccess, markVisionIncapable, isVisionCapabilityError,
  describeVisionRouteFailure, type RouteDecision, type Complexity
} from '../agent/router'
import {
  compactTranscript, estimateTokens, transcriptNeedsVision, type TranscriptEntry
} from '../agent/transcript'
import { formatToolMessageContent } from '../agent/toolMessage'
import { buildToolMeta } from '../agent/toolMeta'
import { callLLM, type LlmResult } from '../agent/llm'
import { SYSTEM_PROMPT } from '../agent/prompts'
import {
  effectiveAutoMemoryConsolidate, effectiveDoneGate, harnessPreamble, harnessProfile
} from '../agent/harnessMode'
import { fireHook } from '../agent/hooksClient'
import { filterEnabledSkills } from '../utils/skillVisibility'
import { buildTranscriptText, imageAttachments, type ChatAttachment } from '../utils/attachments'
import { useStreamingStore } from './streaming'
import { useQuestionStore } from './userQuestions'
import { usePlanStore } from './plan'

/** Web UI file paths that justify a visual verification pass after edits. */
const WEB_UI_FILE_RE =
  /\.(html?|css|scss|less|jsx|tsx|vue|svelte|astro)$/i
import { compactWithSummary } from '../agent/compaction'
import { COMPUTER_HALT_TEXT, endsWithObservation, isComputerCall, isNativeComputerCall } from '../agent/computerToolset'
import { decideAfterTurn, evaluateGoal, useUltraWorkStore } from './ultraWork'
import { ultraWorkPreamble } from '../agent/ultraWork'
import { getConnectedProviders, hiddenToolNames, refreshConnectedProviders } from '../agent/toolsets'
import { classifyComplexity, refreshDecisionStatus } from '../agent/decision'
import { TOOLS } from '../agent/toolDefinitions'
import i18n from '../i18n'

// Round ceiling and compaction ratio come from the harness profile
// (default 50 rounds / 0.6; eco 25 / 0.45; maxing 80 / 0.7).
/** Consecutive identical tool-call sets before we call it a loop and stop. */
const MAX_REPEATED_TOOL_ROUNDS = 12
/** Model attempts per round before the turn gives up (each on a different model). */
const MAX_ROUTE_ATTEMPTS = 3
const STATIC_TOOL_NAMES = TOOLS.map((t) => t.name)

/** Frozen per session so the preamble (and the prompt cache) stays stable. */
const profileBlockBySession = new Map<string, string>()

export async function agentLoop(
  projectId: string,
  sessionId: string,
  userContent: string,
  set: ChatSet,
  get: ChatGet,
  attachments?: ChatAttachment[],
  epoch: number = getSessionEpoch(sessionId),
  resumeFrom?: AgentTurnCheckpoint
): Promise<void> {
  // Superseded before we even started (steer / newer queue item claimed epoch).
  if (epoch !== getSessionEpoch(sessionId)) return

  // A live loop for *this session* owns the turn; other sessions may run in parallel.
  const existing = sessionControllers.get(sessionId)
  if (existing && !existing.signal.aborted) return

  const { providers, models } = useProviderStore.getState()
  if (providers.filter((p) => p.enabled).length === 0 || models.filter((m) => m.enabled).length === 0) {
    const noProviderError: MessageErrorInfo = { kind: 'generic', detail: '', settingsTarget: 'providers' }
    systemError(projectId, sessionId, i18n.t('chat.errors.noProvider'), noProviderError)
    if (epoch === getSessionEpoch(sessionId)) {
      setSessionStreamingFlags(set, get, sessionId, false)
      processQueue(set, get, sessionId)
    }
    return
  }

  // Each loop owns its controller. Only this session's finally clears flags when
  // it is still the current epoch (a steered replacement must not be clobbered).
  const controller = new AbortController()
  sessionControllers.set(sessionId, controller)
  const signal = controller.signal
  useChangeLedger.getState().beginTurn(sessionId, projectId, userContent)
  void acquireSleepHold()

  // Hoisted so finally can auto-capture Memory from this turn's transcript.
  let entries: TranscriptEntry[] = []
  /** Wall-clock start + assistant bubbles of this turn, for the "worked for" label. */
  const turnStartedAt = Date.now()
  const turnAssistantIds: string[] = []
  /** Code mutations this user turn — drives free local typecheck auto-verify. */
  let turnHadCodeEdits = resumeFrom?.turnHadCodeEdits ?? false
  let turnRanChecks = resumeFrom?.turnRanChecks ?? false
  let autoVerifyDone = resumeFrom?.autoVerifyDone ?? false
  // Verify-quality ladder: consecutive failed done-gates bump the fix round to
  // a higher tier (weak models get unstuck; strong models never notice).
  let verifyFailRounds = 0
  let verifyEscalate = 0
  // Web UI files touched this turn → one visual-verify instruction at the end.
  const changedWebFiles = new Set<string>()
  let visualVerifyPrompted = false
  // Git checkpoint fires once per turn, before the first file-mutating tool.
  let gitCheckpointDone = false
  let consecutiveToolErrors = resumeFrom?.consecutiveToolErrors ?? 0
  let emptyResponses = resumeFrom?.emptyResponses ?? 0
  let round = resumeFrom?.round ?? 0
  let complexity: Complexity = resumeFrom?.complexity ?? estimateComplexity(userContent)
  let userMessageAppended = resumeFrom?.userMessageAppended ?? false
  /** completed | aborted | failed — failed leaves checkpoint for cold resume. */
  let turnEnd: 'completed' | 'aborted' | 'failed' = 'completed'

  try {
    const project = useAppStore.getState().projects.find((p) => p.id === projectId)
    const projectPaths = (project?.paths || []).filter(Boolean)
    const session = project?.sessions.find((s) => s.id === sessionId)
    // Selected multi-root path (session.path) wins over primary paths[0].
    let projectPath =
      (session?.path && projectPaths.includes(session.path) ? session.path : null) ||
      projectPaths[0]
    // No project folder (General chat): work in the shared artifacts folder,
    // never in the app process's own working directory.
    const generalWorkspace = !projectPath ? await generalWorkspaceDir().catch(() => null) : null
    if (generalWorkspace) projectPath = generalWorkspace
    const cwd = session?.path || projectPath || ''

    // System prompt as ordered layers. Caching is a prefix match, so the most
    // stable content comes first and per-turn content only ever appends at the
    // tail of `messages` — never into the system block.
    //   layer 0: base prompt        — identical everywhere, shared cache
    //   preamble : cwd + project ctx — injected into messages, not the system block,
    //   so the system cache prefix is shared across all projects and sessions.
    const systemLayers: string[] = [SYSTEM_PROMPT]
    let projectPreamble = ''
    if (cwd) {
      projectPreamble += `--- Working Directory ---\n${cwd}\nResolve relative paths against this directory unless told otherwise.`
      if (generalWorkspace) {
        projectPreamble +=
          '\nNo project folder is open: this is the shared Pawn workspace (Downloads/pawn-artifacts). Put files you create here unless the user names another location, and link them with absolute file:// paths.'
      }
    }
    if (projectPaths.length > 1) {
      projectPreamble +=
        (projectPreamble ? '\n\n' : '') +
        `--- Project roots (multi-folder) ---\n` +
        projectPaths
          .map((p, i) => {
            const tag =
              projectPath && p === projectPath
                ? 'active'
                : i === 0
                  ? 'primary'
                  : `extra-${i}`
            return `${tag}: ${p}`
          })
          .join('\n') +
        `\nActive tool cwd is the path marked active (session root chip). When the user names a path under another root, resolve absolute paths against that root.`
    }
    if (projectPath) {
      try {
        // Load context from each root; primary first (stable order for cache).
        const blocks: string[] = []
        for (const root of projectPaths.slice(0, 4)) {
          try {
            const ctx = await loadProjectContext(root)
            const block = buildProjectContextBlock({
              ...ctx,
              skills: filterEnabledSkills(ctx.skills)
            })
            if (block) {
              blocks.push(
                projectPaths.length > 1 ? `### Root: ${root}\n${block}` : block
              )
            }
          } catch {
            /* optional per-root */
          }
        }
        if (blocks.length) {
          projectPreamble += (projectPreamble ? '\n\n' : '') + blocks.join('\n\n')
        }
      } catch {
        // Missing CLAUDE.md / skills is normal; keep the base layer.
      }
      // Do NOT auto-inject repo_map here: DeepSeek disk cache requires a stable
      // prefix (https://api-docs.deepseek.com/guides/kv_cache/). A rotating map
      // forces full re-prime every TTL. Use the repo_map tool on demand instead.
    }
    const agentMode = useProviderStore.getState().agentModeFor(sessionId)
    if (agentMode === 'plan') {
      projectPreamble +=
        (projectPreamble ? '\n\n' : '') +
        '--- Agent mode: PLAN ---\n' +
        'You are in Plan mode: explore, design, and call update_plan. ' +
        'Do not edit files, run shell that changes state, or use computer/browser actions that mutate. ' +
        'When the plan is ready, call request_plan_approval with it; if approved you switch to Build and implement in the same turn.'
    }
    // Harness mode (eco / maxing) rides in the preamble like Plan mode so the
    // system prefix cache stays shared; default adds nothing.
    const harnessMode = useProviderStore.getState().harnessModeFor(sessionId)
    const harness = harnessProfile(harnessMode)
    const harnessBlock = harnessPreamble(harnessMode)
    if (harnessBlock) {
      projectPreamble += (projectPreamble ? '\n\n' : '') + harnessBlock
    }
    // Ultra Work: goal contract rides in the preamble (stable across rounds).
    const ultraRun = useUltraWorkStore.getState().get(sessionId)
    if (ultraRun?.status === 'active') {
      projectPreamble += (projectPreamble ? '\n\n' : '') + ultraWorkPreamble(ultraRun)
    }
    // Long-term Memory injection (local, optional)
    try {
      if (window.api?.memory?.injectBlock) {
        const mem = await window.api?.memory.injectBlock({
          query: userContent.slice(0, 500),
          projectId: projectId && projectId !== '__general__' ? projectId : null
        })
        if (mem && String(mem).trim()) {
          projectPreamble += (projectPreamble ? '\n\n' : '') + String(mem)
        }
      }
    } catch {
      // Memory optional
    }
    // Repo onboarding profile (learned commands, conventions, gotchas). Frozen
    // for the session so the preamble — and the prompt cache — stays stable.
    if (projectPath && !generalWorkspace) {
      let block = profileBlockBySession.get(sessionId)
      if (block === undefined) {
        const profile = await loadProfile(projectPath).catch(() => null)
        block = profile ? formatProfileBlock(profile) : ''
        profileBlockBySession.set(sessionId, block)
      }
      if (block) projectPreamble += (projectPreamble ? '\n\n' : '') + block
    }
    // systemLayers stays [SYSTEM_PROMPT] only — project context is passed as
    // preamble to callLLM, where it is injected into the messages array.

    if (resumeFrom?.entries?.length) {
      entries = resumeFrom.entries
      userMessageAppended = true
      // Restore sticky route so resume does not re-prime a cold model mid-turn.
      if (resumeFrom.warmFor) {
        try {
          setSessionRoute(
            sessionId,
            resumeFrom.warmFor,
            resumeFrom.warmTier || 'mid',
            estimateTokens(entries)
          )
        } catch {
          /* optional */
        }
      }
    } else {
      entries = await loadTranscript(projectId, sessionId)
    }
    hydrateNotes(sessionId, entries)

    // Correction learning: the user correcting the previous turn becomes a
    // durable lesson (project Memory + repo profile). Fire-and-forget.
    if (!resumeFrom && window.api?.memory?.save) {
      const prevAssistant = [...entries].reverse().find((e) => e.role === 'assistant' && !!e.content?.trim())
      const prevUser = [...entries].reverse().find((e) => e.role === 'user')
      const reverted = takeRecentRevert(sessionId)
      const signal = detectCorrection(userContent, { hadAgentTurn: !!prevAssistant, reverted: !!reverted })
      if (signal && signal.confidence >= 0.6) {
        void learnFromCorrection({
          sessionId,
          projectId: projectId && projectId !== '__general__' ? projectId : null,
          projectPath,
          correction: userContent,
          previousRequest: prevUser?.content,
          previousAnswer: prevAssistant?.content,
          reverted,
          useModel: useProviderStore.getState().smartCompaction !== false
        })
          .then((r) => {
            if (r?.saved) {
              useUsageStore.getState().noteDiagnostic(sessionId, 'info', i18n.t('chat.diagnostics.lessonLearned', { rule: r.rule.slice(0, 120) }))
            }
          })
          .catch(() => {})
      }
    }

    // Lifecycle hooks (Claude/Codex-compatible) — SessionStart once per empty transcript.
    // Skip UserPromptSubmit on resume (prompt already accepted before crash).
    if (!resumeFrom) {
      try {
        const isFresh = entries.filter((e) => e.role === 'user' || e.role === 'assistant').length === 0
        if (isFresh) {
          const start = await fireHook({
            event: 'SessionStart',
            sessionId,
            projectPath: projectPath || null,
            cwd: cwd || projectPath || undefined,
            payload: { source: 'startup' }
          })
          if (start.additionalContext.length) {
            projectPreamble +=
              (projectPreamble ? '\n\n' : '') +
              '--- Hook context ---\n' +
              start.additionalContext.join('\n')
          }
        }
        const submit = await fireHook({
          event: 'UserPromptSubmit',
          sessionId,
          projectPath: projectPath || null,
          cwd: cwd || projectPath || undefined,
          payload: { prompt: userContent.slice(0, 8000) }
        })
        if (submit.decision === 'deny') {
          systemError(
            projectId,
            sessionId,
            submit.reason || i18n.t('chat.errors.hookBlocked')
          )
          return
        }
        if (submit.additionalContext.length) {
          projectPreamble +=
            (projectPreamble ? '\n\n' : '') +
            '--- Hook context ---\n' +
            submit.additionalContext.join('\n')
        }
      } catch {
        /* hooks optional */
      }
    }

    if (!userMessageAppended) {
      const imgs = imageAttachments(attachments)
      // Files named in the message are attached up front (saves read rounds).
      let mentioned = ''
      if (projectPaths.length) {
        try {
          const roots = Array.from(new Set([cwd, ...projectPaths].filter(Boolean)))
          const files = await prefetchMentionedFiles(userContent, {
            roots,
            read: async (p) => {
              const r = await window.api?.fs?.readFile(p).catch(() => null)
              return typeof r === 'string' ? r : null
            },
            isFile: async (p) => {
              const st = window.api?.fs?.stat ? await window.api.fs.stat(p).catch(() => null) : null
              return !!st && 'isFile' in st && st.isFile && st.size <= 1_000_000
            }
          })
          for (const f of files) {
            const r = await window.api?.fs?.readFile(f.path).catch(() => null)
            if (typeof r === 'string') noteFileSeen(snapshotScope({ sessionId }), f.path, r)
          }
          mentioned = formatPrefetched(files)
        } catch {
          /* prefetch is an optimization only */
        }
      }
      entries.push({
        role: 'user',
        content: buildTranscriptText(userContent, attachments) + mentioned,
        ...(imgs.length > 0 ? { attachments: imgs } : {})
      })
      userMessageAppended = true
    }

    let lastDecision: RouteDecision | null = null
    // Hard backstop for pathological repetition; the stuck-recovery ladder
    // below normally intervenes long before.
    const loopCounter = new ToolLoopCounter(MAX_REPEATED_TOOL_ROUNDS)
    const stuck = new StuckDetector()
    let stuckEscalate = 0
    const toolHistory: Array<{ call: string; result: string; isError?: boolean }> = []
    const turnToolCwd = cwd || projectPath
    let turnUsedBrowser = false
    // Files shell commands create are detected against this (Agent changes / undo).
    const fileBaseline = turnToolCwd ? takeFileBaseline(turnToolCwd).catch(() => null) : Promise.resolve(null)
    // Account-backed tool groups are hidden while disconnected (bounded wait).
    await refreshConnectedProviders()
    // Decision models (optional): the decide tool's visibility and the
    // routing assist both read this cached status.
    await refreshDecisionStatus()
    if (!resumeFrom?.complexity && useProviderStore.getState().routingMode === 'auto') {
      const judged = await classifyComplexity(userContent).catch(() => null)
      if (judged) {
        if (judged.complexity !== complexity) {
          useUsageStore.getState().noteDiagnostic(
            sessionId,
            'info',
            i18n.t('chat.diagnostics.decisionComplexity', {
              from: complexity,
              to: judged.complexity,
              pct: Math.round(judged.probability * 100),
              model: judged.model
            })
          )
        }
        complexity = judged.complexity
      }
    }

    // Complex task with no plan yet → require a written plan before edits.
    // Weak models skid when they start patching files without a scaffold; the
    // plan strip also gives the user an early veto. Soft instruction (one
    // transcript note), not a tool lock — speed still wins ties.
    if (
      complexity === 'complex' &&
      useProviderStore.getState().agentModeFor(sessionId) === 'build' &&
      usePlanStore.getState().getPlan(sessionId).length === 0 &&
      !signal.aborted
    ) {
      entries.push({
        role: 'user',
        content:
          '<planning>\nThis task looks complex. Before editing any file, call update_plan with a short ' +
          'plan (3-6 steps, concrete files/outcomes) and keep it updated as you go. Work through it ' +
          'step by step; if the task turns out simpler than expected, shrink the plan rather than ' +
          'skipping it.\n</planning>'
      })
    }

    // Persist immediately so a crash mid-first-LLM-call can still resume.
    checkpointSnapshot({
      projectId,
      sessionId,
      userContent,
      attachments,
      entries,
      round,
      consecutiveToolErrors,
      emptyResponses,
      complexity,
      turnHadCodeEdits,
      turnRanChecks,
      autoVerifyDone,
      userMessageAppended
    })

    while (round < harness.maxToolRounds) {
      if (signal.aborted) break
      round++

      // Soft spend caps (session + daily). 0 = unlimited.
      const budgetStop = await checkSpendBudget(sessionId)
      if (budgetStop) {
        systemError(projectId, sessionId, budgetStop)
        turnEnd = 'completed'
        break
      }

      // Compaction runs at a threshold and the result is persisted, so it costs
      // exactly one cache re-prime — unlike a sliding window, which would silently
      // re-prime on every single request.
      const contextWindow = lastDecision?.model.contextWindow || 128_000
      let tokenEst = estimateTokens(entries)
      useUsageStore.getState().noteContext(sessionId, tokenEst, contextWindow, false)
      // Gentle stage first: clear stale bulky tool results (saved as outputs
      // the agent can read back) before a full compaction is needed.
      const clearAt = contextWindow * Math.max(0.3, harness.compactAtRatio - 0.15)
      if (tokenEst > clearAt && tokenEst <= contextWindow * harness.compactAtRatio + contextWindow * 0.2) {
        const cleared = await clearOldToolResults(entries, {
          keepRecent: 8,
          minKeep: 3,
          keepRecentTokens: Math.round(contextWindow * 0.25),
          targetTokens: Math.max(15_000, Math.round(contextWindow * 0.12)),
          minTokens: 6_000,
          offload: (content) => offloadOutput(sessionId, content)
        }).catch(() => null)
        if (cleared && cleared.cleared > 0) {
          entries = cleared.entries
          persistTranscript(sessionId, entries, lastDecision?.key || '', lastDecision?.tier)
          tokenEst = estimateTokens(entries)
          useUsageStore.getState().noteDiagnostic(
            sessionId,
            'info',
            i18n.t('chat.diagnostics.toolResultsCleared', { count: cleared.cleared, tokens: Math.round(cleared.tokensSaved / 1000) })
          )
          useUsageStore.getState().noteContext(sessionId, tokenEst, contextWindow, true)
        }
      }
      if (tokenEst > contextWindow * harness.compactAtRatio) {
        setCompactingActivity(projectId, sessionId, true)
        const compacted = await compactWithSummary(entries, {
          sessionId,
          contextWindow,
          plan: currentPlanFor(sessionId),
          notes: getNotes(sessionId),
          useModel: useProviderStore.getState().smartCompaction,
          signal
        }).catch(() => null)
        setCompactingActivity(projectId, sessionId, false)
        if (signal.aborted) break
        entries = compacted?.compacted
          ? compacted.entries
          : compactTranscript(entries, { keepEntries: 30, plan: currentPlanFor(sessionId), notes: getNotes(sessionId) })
        persistTranscript(sessionId, entries, lastDecision?.key || '', lastDecision?.tier)
        useUsageStore
          .getState()
          .noteDiagnostic(
            sessionId,
            'info',
            i18n.t(compacted?.usedModel ? 'chat.diagnostics.compactedSmart' : 'chat.diagnostics.compacted')
          )
        useUsageStore
          .getState()
          .noteContext(sessionId, estimateTokens(entries), contextWindow, true)
      }

      const escalate = shouldEscalate({ consecutiveToolErrors, round, emptyResponses }) + stuckEscalate + verifyEscalate
      const excluded = new Set<string>()
      let transientFailures = 0
      let result: LlmResult | null = null
      let decision: RouteDecision | null = null
      let lastAssistantMsgId: string | null = null

      let needsVision = transcriptNeedsVision(entries)
      // Read-only tools start while the response is still streaming.
      let early = new Map<string, { started: number; promise: Promise<ToolResult> }>()
      const permissionModeNow = useProviderStore.getState().permissionMode
      const startEarly = (tc: ToolCall): void => {
        if (signal.aborted || permissionModeNow === 'ask' || early.has(tc.id)) return
        const eff = effectiveToolName(tc)
        if (TOOL_SAFETY[eff] !== 'safe' || NEEDS_APPROVAL_IN_AUTO.has(eff)) return
          early.set(tc.id, {
            started: Date.now(),
            promise: executeTool(tc, turnToolCwd, signal, { sessionId, projectId }).catch((err) => ({
              toolCallId: tc.id,
              content: i18n.t('chat.toolMessage.toolError', {
                name: tc.name,
                message: String(err).replace(/^Error: /, '').slice(0, 300)
              }),
              isError: true
            }))
          })
      }

      // Try up to MAX_ROUTE_ATTEMPTS distinct models before failing the turn.
      for (let attempt = 0; attempt < MAX_ROUTE_ATTEMPTS; attempt++) {
        if (signal.aborted) break
        decision = route({
          sessionId,
          entries,
          complexity,
          // After two transient failures in a row, try a stronger tier instead
          // of retrying the same tier a third time.
          escalate: escalate + (transientFailures >= 2 ? 1 : 0),
          exclude: excluded,
          newTurn: round === 1,
          needsVision,
          harnessMode
        })
        // No vision model: demote screenshots to text stubs and continue on
        // DeepSeek/text models instead of killing the whole computer-use turn.
        if (!decision && needsVision) {
          entries = demoteVisionPayloadsToText(entries)
          needsVision = false
          useUsageStore.getState().noteDiagnostic(
            sessionId,
            'warn',
            i18n.t('chat.diagnostics.visionDemoted')
          )
          decision = route({
            sessionId,
            entries,
            complexity,
            escalate: escalate + (transientFailures >= 2 ? 1 : 0),
            exclude: excluded,
            newTurn: round === 1,
            needsVision: false
          })
        }
        if (!decision) break

        // Surface why the router picked this model (escalation, fallback,
        // downgrade, context limits, vision) in the usage diagnostics panel.
        if (/escalat|fell back|downgrade|context too small|vision/.test(decision.reason)) {
          useUsageStore.getState().noteDiagnostic(
            sessionId,
            'info',
            i18n.t('chat.diagnostics.routing', {
              model: decision.model.label || decision.model.modelId,
              reason: decision.reason
            })
          )
        }

        // Results of a failed attempt belong to calls that never happened.
        early = new Map()
        const assistantMsgId = `${Date.now()}-assistant-${round}-${attempt}`
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: assistantMsgId, role: 'assistant', content: '', createdAt: Date.now()
        })
        turnAssistantIds.push(assistantMsgId)

        try {
         result = await callLLM({
            decision, entries, systemLayers, projectPreamble, sessionId, projectId, projectPath, assistantMsgId, signal,
            complexity,
            onToolCall: startEarly,
            toolDenylist: hiddenToolNames({
              entries,
              allToolNames: STATIC_TOOL_NAMES,
              connected: getConnectedProviders(),
              mode: useProviderStore.getState().toolLoading
            })
         })
          noteProviderSuccess(decision.provider.id)
          // Vision-only fallbacks must not steal sticky from the text model
          // (DeepSeek coding + Gemini image turn → next text turn stays DeepSeek).
          if (!decision.ephemeral) {
            setSessionRoute(sessionId, decision.key, decision.tier, estimateTokens(entries))
          }
          useUsageStore.getState().noteRoute(
            sessionId,
            decision.model.label || decision.model.modelId,
            decision.reason
          )
          useUsageStore.getState().record(sessionId, decision.model, result.usage)

          // Tag the message bubble with the model that produced it so the UI
          // can show "answered by <model>" in auto mode — also when vision
          // fallback switched away from the pinned text model.
          const { routingMode } = useProviderStore.getState()
          const showModel = (routingMode === 'auto' || decision.ephemeral)
            && currentMessageContent(projectId, sessionId, assistantMsgId).trim()
          if (showModel) {
            useAppStore.getState().updateMessageModel(
              projectId, sessionId, assistantMsgId,
              decision.model.label || decision.model.modelId
            )
          }

          // Empty-bubble policy:
          // - Intermediate turn with tool calls: drop the blank assistant row
          //   (tool cards carry the signal).
          // - Final turn with no tools: never vanish silently — fill a clear
          //   error so the user knows the model returned nothing.
          // Prefer what was actually streamed into the bubble (includes cases
          // where reasoning models stream text that is not mirrored in
          // result.text alone).
          const displayed = currentMessageContent(projectId, sessionId, assistantMsgId).trim()
          const hasTools = result.toolCalls.length > 0
          if (!displayed) {
            if (hasTools) {
              useAppStore.getState().removeMessage(projectId, sessionId, assistantMsgId)
            } else {
              const emptyMsg = i18n.t('chat.errors.emptyResponse')
              useAppStore.getState().updateMessageContent(
                projectId, sessionId, assistantMsgId, emptyMsg
              )
              result = { ...result, text: emptyMsg }
            }
          }
          lastDecision = decision
          lastAssistantMsgId = assistantMsgId
          break
        } catch (err) {
          // The message may already hold real, useful text streamed before the
          // failure (a dropped connection mid-stream, or the user hitting Stop).
          // Deleting it unconditionally threw away content the user had already
          // read on screen. Only discard a truly empty placeholder outright.
          const streamed = currentMessageContent(projectId, sessionId, assistantMsgId)
          if (signal.aborted) {
            // Stop is terminal — there is no retry to deduplicate against, so
            // whatever was streamed becomes the final answer for this round.
            if (!streamed.trim()) useAppStore.getState().removeMessage(projectId, sessionId, assistantMsgId)
            throw err
          }
          const message = err instanceof Error ? err.message : String(err)
          // Preserve partial stream on failover: keep the bubble with a note so
          // the user never loses text they already read; the next attempt gets
          // a fresh assistant bubble.
          if (streamed.trim()) {
            const note = i18n.t('chat.diagnostics.partialPreserved', {
              model: decision.model.label || decision.model.modelId,
              error: message.slice(0, 120)
            })
            useAppStore.getState().updateMessageContent(
              projectId,
              sessionId,
              assistantMsgId,
              `${streamed.trim()}\n\n${note}`,
              true
            )
            useAppStore.getState().updateMessageModel(
              projectId,
              sessionId,
              assistantMsgId,
              decision.model.label || decision.model.modelId
            )
          } else {
            useAppStore.getState().removeMessage(projectId, sessionId, assistantMsgId)
          }

          // Image-incapable models: free the retry budget for a real vision model.
          // Never session-ban models explicitly marked Vision (Gemini etc.) — broad
          // API errors used to lock the whole session into "no vision model".
          if (needsVision && isVisionCapabilityError(err)) {
            if (decision.model.supportsVision !== true) {
              markVisionIncapable(decision.key)
            }
            useUsageStore.getState().noteDiagnostic(
              sessionId,
              'info',
              i18n.t('chat.diagnostics.visionFallback', {
                model: decision.model.label || decision.model.modelId
              })
            )
            transientFailures = 0
          } else if ((err as { transient?: boolean }).transient !== false) {
            // Only transient failures (network, 429, 5xx, overloaded) cool the
            // provider down; a bad key or unknown model is permanent and should
            // not punish the provider's other models.
            transientFailures++
            noteProviderFailure(decision.provider.id)
          } else {
            transientFailures = 0
          }
          excluded.add(decision.key)
          result = null
          if (attempt === MAX_ROUTE_ATTEMPTS - 1) {
            systemError(
              projectId,
              sessionId,
              i18n.t('chat.errors.allAttemptsFailed', { error: message }),
              classifyLlmError(message)
            )
          }
        }
      }

      if (!decision) {
        if (needsVision) {
          const code = describeVisionRouteFailure()
          const detailKey =
            code === 'fallback_disabled'
              ? 'chat.errors.noVisionFallbackDisabled'
              : code === 'fallback_provider_off'
                ? 'chat.errors.noVisionFallbackProvider'
                : code === 'no_vision_models'
                  ? 'chat.errors.noVisionModel'
                  : 'chat.errors.noVisionModel'
          systemError(projectId, sessionId, i18n.t(detailKey), {
            kind: 'generic',
            detail: '',
            settingsTarget: 'models'
          })
        } else {
          systemError(projectId, sessionId, i18n.t('chat.errors.noUsableModel'), {
            kind: 'generic',
            detail: '',
            settingsTarget: 'models'
          })
        }
        break
      }
      if (!result) break
      if (signal.aborted) break

      const hasTools = result.toolCalls.length > 0
      if (!result.text.trim() && !hasTools) emptyResponses++
      else emptyResponses = 0

      entries.push({
        role: 'assistant',
        content: result.text,
        ...(hasTools ? { toolCalls: result.toolCalls } : {}),
        ...(result.thinking.length > 0 ? { thinking: result.thinking } : {}),
        // DeepSeek: always persist reasoning with tool calls (even "") so the
        // next request can satisfy "reasoning_content must be passed back".
        ...(hasTools || result.reasoningContent
          ? { reasoningContent: result.reasoningContent || '' }
          : {})
      })

      // Durable after model reply (before tools) so a mid-tool crash can resume.
      if (!signal.aborted && hasTools && decision) {
        checkpointSnapshot({
          projectId,
          sessionId,
          userContent,
          attachments,
          entries,
          round,
          consecutiveToolErrors,
          emptyResponses,
          complexity,
          turnHadCodeEdits,
          turnRanChecks,
          autoVerifyDone,
          warmFor: decision.key,
          warmTier: decision.tier,
          userMessageAppended
        })
      }

      // Effective tool cwd: session override path, else project root.
      const toolCwd = cwd || projectPath

      if (!hasTools) {
        // Free local power: after code edits, run typecheck once without the model
        // asking. Green → surface OK and stop (no extra LLM round). Fail → feed
        // results back and continue so the agent can fix. Auto/yolo run it
        // silently; ask mode asks once via the question card (never spams
        // permission prompts). No paid services.
        const { permissionMode: perm } = useProviderStore.getState()
        const doneGate = effectiveDoneGate(useProviderStore.getState().doneGate, harnessMode)
        const agentMode = useProviderStore.getState().agentModeFor(sessionId)
        const gateKind = doneGate === 'test' ? 'test' : doneGate === 'typecheck' ? 'typecheck' : null
        const canAuto =
          agentMode === 'build' &&
          gateKind != null &&
          !!toolCwd &&
          turnHadCodeEdits &&
          !turnRanChecks &&
          !autoVerifyDone &&
          !signal.aborted
        if (canAuto && gateKind && perm !== 'ask') {
          autoVerifyDone = true
          try {
            // Up to 90s of silent checking reads as a hang — label the wait.
            if (lastAssistantMsgId) {
              useStreamingStore.getState().setActivity(lastAssistantMsgId, i18n.t('chat.checksRunning'))
            }
            const checkText = await runProjectChecks(toolCwd, gateKind, 90, targetSandboxOpts(projectId))
            const noCmd =
              /No command for kind=|No standard check commands detected/i.test(checkText)
            if (!noCmd) {
              const failed = /\bFAIL\b|exit: (?!0)\d+/.test(checkText)
              const sysId = `${Date.now()}-auto-${gateKind}`
              useAppStore.getState().addMessage(projectId, sessionId, {
                id: sysId,
                role: 'system',
                content: `[auto_verify ${gateKind}]\n${checkText.slice(0, 12_000)}`,
                createdAt: Date.now()
              })
              if (failed) {
                // Same gate failing twice in a row means the current tier is
                // stuck on these errors — spend one tier step on the fix round.
                verifyFailRounds++
                const needEscalate = verifyFailRounds >= 2 ? 1 : 0
                if (needEscalate) {
                  useUsageStore.getState().noteDiagnostic(
                    sessionId,
                    'info',
                    i18n.t('chat.diagnostics.escalateOnVerifyFail')
                  )
                }
                verifyEscalate = needEscalate
                entries.push({
                  role: 'user',
                  content:
                    `<auto_verify kind="${gateKind}">\n${checkText.slice(0, 12_000)}\n</auto_verify>\n` +
                    `${gateKind} failed after your edits. Fix the errors with tools, then finish.`
                })
                turnRanChecks = true
                persistTranscript(sessionId, entries, decision.key, decision.tier)
                continue
              }
            }
          } catch {
            // done-gate optional — do not block the turn
          } finally {
            if (lastAssistantMsgId) {
              useStreamingStore.getState().setActivity(lastAssistantMsgId, null)
            }
          }
        } else if (canAuto && gateKind && perm === 'ask') {
          // Ask mode: the verify loop is exactly what weak models need most, so
          // offer it as a single question instead of silently skipping.
          autoVerifyDone = true
          try {
            const answer = await useQuestionStore.getState().ask(
              {
                sessionId,
                kind: 'question',
                question: i18n.t('chat.verifyAsk.question', { kind: gateKind }),
                options: [
                  { label: i18n.t('chat.verifyAsk.run') },
                  { label: i18n.t('chat.verifyAsk.skip') }
                ],
                multiSelect: false,
                allowOther: false
              },
              signal
            )
            const runLabel = i18n.t('chat.verifyAsk.run')
            if (!answer.aborted && !answer.dismissed && answer.selected.includes(runLabel)) {
              if (lastAssistantMsgId) {
                useStreamingStore.getState().setActivity(lastAssistantMsgId, i18n.t('chat.checksRunning'))
              }
              const checkText = await runProjectChecks(toolCwd, gateKind, 90, targetSandboxOpts(projectId))
              const noCmd =
                /No command for kind=|No standard check commands detected/i.test(checkText)
              if (!noCmd) {
                const failed = /\bFAIL\b|exit: (?!0)\d+/.test(checkText)
                const sysId = `${Date.now()}-auto-${gateKind}`
                useAppStore.getState().addMessage(projectId, sessionId, {
                  id: sysId,
                  role: 'system',
                  content: `[auto_verify ${gateKind}]\n${checkText.slice(0, 12_000)}`,
                  createdAt: Date.now()
                })
                if (failed) {
                  verifyFailRounds++
                  verifyEscalate = verifyFailRounds >= 2 ? 1 : 0
                  entries.push({
                    role: 'user',
                    content:
                      `<auto_verify kind="${gateKind}">\n${checkText.slice(0, 12_000)}\n</auto_verify>\n` +
                      `${gateKind} failed after your edits. Fix the errors with tools, then finish.`
                  })
                  turnRanChecks = true
                  persistTranscript(sessionId, entries, decision.key, decision.tier)
                  continue
                }
              }
            }
          } catch {
            // question UI unavailable (headless) — skip silently
          } finally {
            if (lastAssistantMsgId) {
              useStreamingStore.getState().setActivity(lastAssistantMsgId, null)
            }
          }
        }
        // Visual verify: UI files changed → have the model confirm the page
        // actually renders (the #1 vibe-coding failure is "looks done but is
        // broken"). Instruction-only; the model uses its existing browser
        // tools, so ask mode stays in control of the tools. Fired once per
        // turn; if the model has no way to check, it says so in one line.
        if (
          agentMode === 'build' &&
          turnHadCodeEdits &&
          !signal.aborted &&
          !visualVerifyPrompted &&
          changedWebFiles.size > 0
        ) {
          visualVerifyPrompted = true
          entries.push({
            role: 'user',
            content:
              `<visual_verify>\nUI files were changed in this turn (${[...changedWebFiles].slice(0, 6).join(', ')}). ` +
              `Before finishing: if a dev server for this project is already running, navigate to it with browser_navigate; ` +
              `otherwise skip silently. Take a screenshot (browser_screenshot or computer_screenshot) and check the page ` +
              `renders correctly — no blank page, no layout collapse. Read browser_console for errors. ` +
              `Fix what is broken. If no server is running, say so in one line and finish.\n</visual_verify>`
          })
          persistTranscript(sessionId, entries, decision.key, decision.tier)
          continue
        }
        persistTranscript(sessionId, entries, decision.key, decision.tier)
        break
      }

      if (loopCounter.record(result.toolCalls)) {
        const names = [...new Set(result.toolCalls.map((tc) => tc.name))].join(', ')
        systemError(
          projectId,
          sessionId,
          i18n.t('chat.errors.toolLoop', { names, rounds: MAX_REPEATED_TOOL_ROUNDS })
        )
        break
      }

      // --- Tool execution: safe calls in parallel, risky ones serially so their
      // permission prompts queue up one at a time.
      if (lastAssistantMsgId && result.toolCalls.length > 0) {
        const actionSummary = result.toolCalls.map((tc) => describeToolAction(tc)).join(', ')
        useStreamingStore.getState().setActivity(lastAssistantMsgId, actionSummary)
      }

      const safe: ToolCall[] = []
      const risky: ToolCall[] = []
      for (const tc of result.toolCalls) {
        // Model-native tools classify as the Pawn tool they act as (a text
        // editor "view" is a read and may run in parallel).
        (TOOL_SAFETY[effectiveToolName(tc)] === 'safe' || early.has(tc.id) ? safe : risky).push(tc)
      }

      // Git checkpoint: before the first file-mutating tool of the turn, record
      // a stash entry WITHOUT touching the working tree (stash create + store).
      // A failed attempt becomes disposable — `git stash list` holds the exact
      // pre-edit state. Local git repos only; best-effort by design.
      if (
        !gitCheckpointDone &&
        toolCwd &&
        result.toolCalls.some((tc) => isFileMutation(tc)) &&
        !signal.aborted
      ) {
        gitCheckpointDone = true
        const project = useAppStore.getState().projects.find((p) => p.id === projectId)
        if (!project?.executionHost) {
          void (async (): Promise<void> => {
            try {
              const inside = await window.api.shell.execFile('git', ['rev-parse', '--is-inside-work-tree'], toolCwd)
              if (inside.exitCode !== 0 || !inside.stdout.trim().startsWith('true')) return
              const created = await window.api.shell.execFile(
                'git',
                ['stash', 'create', `pawn-turn ${new Date().toISOString().slice(0, 16)}`],
                toolCwd
              )
              const sha = created.stdout.trim()
              if (created.exitCode === 0 && /^[0-9a-f]{10,}$/.test(sha)) {
                await window.api.shell.execFile('git', ['stash', 'store', '-m', `pawn-turn ${userContent.slice(0, 40)}`, sha], toolCwd)
              }
            } catch {
              // checkpoint is optional
            }
          })()
        }
      }

      const resultsById = new Map<string, ToolResult>()
      const durationsById = new Map<string, number>()
      const timedExecute = async (tc: ToolCall): Promise<ToolResult> => {
        const started = Date.now()
        try {
          return await executeTool(tc, toolCwd, signal, { sessionId, projectId })
        } finally {
          durationsById.set(tc.id, Date.now() - started)
        }
      }
      if (safe.length > 0 && !signal.aborted) {
        const settled = await Promise.all(
          safe.map(async (tc) => {
            const pre = early.get(tc.id)
            if (!pre) return timedExecute(tc)
            const r = await pre.promise
            durationsById.set(tc.id, Date.now() - pre.started)
            return r
          })
        )
        safe.forEach((tc, i) => resultsById.set(tc.id, settled[i]))
      }
      // Computer actions run in order; after the first failure the rest of the
      // batch is answered with the standard halt text (they were planned
      // assuming the earlier ones worked). A native-tool batch that doesn't
      // end by looking at the screen gets a screenshot attached to its last
      // action, saving Claude a round trip.
      let computerHalted = false
      const nativeBatch = risky.some(isNativeComputerCall)
      const lastComputer = [...risky].reverse().find(isComputerCall)
      const observe = nativeBatch && !endsWithObservation(risky)
      for (const tc of risky) {
        if (signal.aborted) break
        const isComputer = isComputerCall(tc)
        if (isComputer && computerHalted) {
          resultsById.set(tc.id, { toolCallId: tc.id, content: COMPUTER_HALT_TEXT, isError: true })
          continue
        }
        const run = observe && tc === lastComputer
          ? { ...tc, arguments: { ...tc.arguments, return_screenshot: true } }
          : tc
        const r = await timedExecute(run)
        resultsById.set(tc.id, r)
        if (isComputer && r.isError) computerHalted = true
      }

      if (lastAssistantMsgId) {
        useStreamingStore.getState().setActivity(lastAssistantMsgId, null)
      }

      // Always record tool results for completed work. On abort, still persist
      // what finished so the next turn knows about side effects (writes, etc.).
      let roundErrors = 0
      for (const tc of result.toolCalls) {
        const raw = resultsById.get(tc.id) ?? {
          toolCallId: tc.id,
          content: signal.aborted
            ? i18n.t('chat.toolMessage.aborted')
            : i18n.t('chat.toolMessage.noResult'),
          isError: true
        }
        if (raw.isError) roundErrors++
        const cap = toolResultCap(tc.name, harness.toolResultScale)
        let truncated = truncateToolResult(raw, tc.name, cap)
        // Too long for context: keep the full text retrievable (read_output).
        // The model-facing note stays in the transcript; the UI row gets the
        // same pointer as structured toolMeta.offloaded and renders a
        // localized, paged view of the saved output instead.
        let offloaded: { id: string; chars: number } | undefined
        if (truncated !== raw.content && raw.content.length > cap) {
          const id = await offloadOutput(sessionId, raw.content)
          if (id) {
            offloaded = { id, chars: raw.content.length }
            truncated += `\n[full output: ${raw.content.length.toLocaleString('en-US')} chars saved — read_output {"id":"${id}"} to page, grep or tail it]`
          }
        }

        if (!raw.isError && isFileMutation(tc)) {
          turnHadCodeEdits = true
          // Track web UI edits for the visual-verify instruction.
          const changedPath: string | undefined =
            raw.diffData?.path || (typeof tc.arguments.path === 'string' ? tc.arguments.path : undefined)
          if (changedPath && WEB_UI_FILE_RE.test(changedPath)) changedWebFiles.add(changedPath)
        }
        if (tc.name.startsWith('browser_')) turnUsedBrowser = true
        // Learn which project commands work (repo profile).
        const eff = effectiveToolName(tc)
        if (projectPath && eff === 'shell_exec' && typeof tc.arguments.command === 'string' && tc.arguments.restart !== true && !tc.arguments.background) {
          learnFromCommand(projectPath, tc.arguments.command, {
            exitCode: raw.isError ? 1 : 0,
            durationMs: durationsById.get(tc.id),
            notFound: /command not found|is not recognized as an internal|No such file or directory.*(npx|npm|pnpm|yarn)/i.test(raw.content)
          })
        }
        toolHistory.push({
          call: `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 300)})`,
          result: raw.content.slice(0, 600),
          isError: raw.isError === true
        })
        if (tc.name === 'run_checks' && !raw.isError) {
          turnRanChecks = true
        }

        const toolMsgId = `${Date.now()}-tool-${tc.id}`
        // The row the user sees never contains the model-facing read_output
        // note; paging UI is driven by toolMeta.offloaded instead.
        const rowSource = offloaded
          ? truncated.replace(/\n\[full output: [^\]]*\]$/, '')
          : truncated
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: toolMsgId,
          role: 'system',
          content: formatToolMessageContent(tc.name, raw.isError === true, rowSource, raw.diffData),
          createdAt: Date.now(),
          toolMeta: buildToolMeta(tc, raw, durationsById.get(tc.id), offloaded)
        })

        entries.push({
          role: 'tool',
          toolCallId: tc.id,
          name: tc.name,
          content: truncated,
          isError: raw.isError === true
        })
      }

      consecutiveToolErrors = roundErrors > 0 ? consecutiveToolErrors + 1 : 0

      // Commands may have created files the ledger never saw.
      const ranCommands = result.toolCalls.some((tc) => effectiveToolName(tc) === 'shell_exec' && resultsById.get(tc.id)?.isError !== true)
      if (ranCommands && !signal.aborted) {
        const created = await recordCommandCreatedFiles(await fileBaseline).catch(() => [])
        if (created.length) turnHadCodeEdits = true
      }
      if (ranCommands || turnHadCodeEdits) window.dispatchEvent(new CustomEvent('pawn:workspace-changed'))

      // Runtime perception: new errors from background jobs / the browser page.
      if (!signal.aborted) {
        const explicitPageCheck = result.toolCalls.some((tc) => tc.name === 'browser_console' || tc.name === 'browser_network')
        const runtimeNote = await collectRuntimeEvents({
          sessionKey: sessionId,
          browserOwner: `session:${sessionId}`,
          poll: window.api?.shell?.poll ? (id) => window.api.shell.poll(id) : undefined,
          runtime: window.api?.browser?.runtime,
          includeBrowser: turnUsedBrowser && !explicitPageCheck
        }).catch(() => '')
        if (runtimeNote) appendToLastToolResult(entries, runtimeNote)
      }

      // Stuck recovery ladder (replaces a hard stop on repeated rounds).
      const step = stuck.observe({
        calls: result.toolCalls,
        results: result.toolCalls.map((tc) => {
          const r = resultsById.get(tc.id)
          return { name: tc.name, isError: r?.isError, content: r?.content || '' }
        })
      })
      if (step && !signal.aborted) {
        useUsageStore.getState().noteDiagnostic(
          sessionId,
          'warn',
          i18n.t('chat.diagnostics.stuckRecovery', { level: step.level, action: step.action, detail: step.signal.detail.slice(0, 140) })
        )
        let nudge = step.nudge
        if (step.action === 'escalate') stuckEscalate = 1
        if (step.action === 'rollback') stuckEscalate = 2
        if (step.action === 'second_opinion') {
          if (lastAssistantMsgId) useStreamingStore.getState().setActivity(lastAssistantMsgId, i18n.t('chat.secondOpinion'))
          const opinion = await requestSecondOpinion(stuckDigest(userContent, toolHistory, step.signal), {
            currentKey: decision.key,
            sessionId,
            signal
          }).catch(() => null)
          if (lastAssistantMsgId) useStreamingStore.getState().setActivity(lastAssistantMsgId, null)
          if (opinion) {
            nudge = nudge.replace('</stuck_recovery>', `<second_opinion model="${opinion.model}">\n${opinion.text}\n</second_opinion>\n</stuck_recovery>`)
            useAppStore.getState().addMessage(projectId, sessionId, {
              id: `${Date.now()}-second-opinion`,
              role: 'system',
              content: `[Tool: second_opinion] OK\n${opinion.model}: ${opinion.text}`,
              createdAt: Date.now()
            })
          }
        }
        appendToLastToolResult(entries, nudge)
        if (step.action === 'ask_user') {
          persistTranscript(sessionId, entries, decision.key, decision.tier)
          systemError(projectId, sessionId, i18n.t('chat.errors.stuckAskUser', { detail: step.signal.detail.slice(0, 200) }))
          break
        }
      }

      persistTranscript(sessionId, entries, decision.key, decision.tier)
      // Never re-mark a Stop'd turn as running (false cold-start resume).
      if (!signal.aborted) {
        checkpointSnapshot({
          projectId,
          sessionId,
          userContent,
          attachments,
          entries,
          round,
          consecutiveToolErrors,
          emptyResponses,
          complexity,
          turnHadCodeEdits,
          turnRanChecks,
          autoVerifyDone,
          warmFor: decision.key,
          warmTier: decision.tier,
          userMessageAppended
        })
      }

      if (signal.aborted) break
    }

    if (round >= harness.maxToolRounds) {
      systemError(projectId, sessionId, i18n.t('chat.errors.maxRounds', { rounds: harness.maxToolRounds }))
    }
  } catch (err) {
    if (!signal.aborted) {
      systemError(projectId, sessionId, i18n.t('chat.errors.agentError', { error: String(err) }))
      // Keep checkpoint on unexpected error so cold start can resume.
      turnEnd = 'failed'
      if (entries.length > 0) {
        checkpointSnapshot({
          projectId,
          sessionId,
          userContent,
          attachments,
          entries,
          round,
          consecutiveToolErrors,
          emptyResponses,
          complexity,
          turnHadCodeEdits,
          turnRanChecks,
          autoVerifyDone,
          userMessageAppended
        })
      }
    }
  } finally {
    const isCurrent =
      sessionControllers.get(sessionId) === controller && epoch === getSessionEpoch(sessionId)
    if (sessionControllers.get(sessionId) === controller) {
      sessionControllers.delete(sessionId)
    }
    const aborted = signal.aborted
    if (aborted) turnEnd = 'aborted'
    else if (turnEnd !== 'failed') turnEnd = 'completed'
    useChangeLedger.getState().endTurn()
    releaseSleepHold()
    if (entries.some((e) => e.role === 'tool' && e.name.startsWith('computer_'))) {
      void window.api?.computer?.releaseAll?.()?.catch?.(() => {})
    }
    recordTurnDuration(projectId, sessionId, turnAssistantIds, Date.now() - turnStartedAt)
    // Turn finished (normally or aborted) — drop the AI cursor so it doesn't
    // linger on the browser page after browser control ends.
    // Release the browser claim when this turn ends. The claim is a no-op
    // today (per-owner tabs supersede it), kept for renderer call-site compat.
    void window.api?.browser?.release?.(sessionId)?.catch?.(() => {})
    if (get().streamingSessionIds.length <= 1) {
      void window.api?.browser?.hideCursor?.()?.catch?.(() => {})
    }
    // Epoch guard: a steer that aborted us may already have started a newer
    // turn. Clearing flags or draining the queue here would race and leave the
    // UI stuck (isStreaming false while tokens still flow, or double loops).
    if (isCurrent) {
      // Unexpected errors leave status=running so cold start can resume.
      if (turnEnd === 'aborted') {
        clearTurnCheckpoint(sessionId, 'aborted')
      } else if (turnEnd === 'completed') {
        clearTurnCheckpoint(sessionId, 'completed')
      }
      setSessionStreamingFlags(set, get, sessionId, false)
      // Turn finished — Stop hook (advisory; used for notify integrations)
      if (!aborted) {
        const project = useAppStore.getState().projects.find((p) => p.id === projectId)
        const projectPaths = (project?.paths || []).filter(Boolean)
        const session = project?.sessions.find((s) => s.id === sessionId)
        const projectPath =
          (session?.path && projectPaths.includes(session.path) ? session.path : null) ||
          projectPaths[0]
        const cwd = session?.path || projectPath || ''
        void fireHook({
          event: 'Stop',
          sessionId,
          projectPath: projectPath || null,
          cwd: cwd || undefined,
          payload: {}
        })
      }
      // Auto-capture durable Memory cards from this turn (local heuristic).
      if (!aborted && window.api?.memory?.ingestTurn && entries.length > 0) {
        try {
          const recent = entries
            .filter((e): e is Extract<TranscriptEntry, { role: 'user' | 'assistant' }> =>
              e.role === 'user' || e.role === 'assistant'
            )
            .slice(-12)
            .map((e) => ({
              role: e.role,
              content: typeof e.content === 'string' ? e.content : ''
            }))
          void window.api?.memory.ingestTurn({
            projectId: projectId && projectId !== '__general__' ? projectId : null,
            sessionId,
            messages: recent
          }).catch(() => {})
          // Quiet merge of near-duplicate cards (threshold 0.92) so memory deepens over time.
          if (
            effectiveAutoMemoryConsolidate(
              useProviderStore.getState().autoMemoryConsolidate,
              useProviderStore.getState().harnessModeFor(sessionId)
            ) &&
            window.api.memory?.consolidate
          ) {
            void window.api?.memory.consolidate({
              projectId: projectId && projectId !== '__general__' ? projectId : null,
              threshold: 0.92,
              dryRun: false
            }).catch(() => {})
          }
        } catch {
          /* non-fatal */
        }
      }
      // One notification per completed turn (chat reply or coding work), only
      // when the user isn't watching the app. Routine runs are skipped here —
      // the routine store notifies on its own.
      if (!aborted && usePrefsStore.getState().taskNotificationsEnabled) {
        const runningRoutine = useRoutineStore.getState().routines.find(
          (r) => r.sessionId === sessionId && useRoutineStore.getState().runningIds.has(r.id)
        )
        if (!runningRoutine && !document.hasFocus()) {
          window.api?.notification?.send?.('Pawn', i18n.t('notifications.taskComplete'))?.catch(() => {})
        }
      }
      // Ultra Work: evaluate the goal and auto-continue (or end the run).
      const ultra = useUltraWorkStore.getState().get(sessionId)
      if (ultra?.status === 'active') {
        if (aborted) {
          useUltraWorkStore.getState().stop(sessionId)
        } else {
          void continueUltraWork(projectId, sessionId, entries, lastAssistantText(projectId, sessionId), set, get)
          return
        }
      }
      // Drain the queue even after a manual stop: queued messages were
      // explicitly scheduled and must not wait for the next user input.
      processQueue(set, get, sessionId)
    }
  }
}

/**
 * After an Ultra Work turn: ask the evaluator, then either start the next
 * iteration (shown as a system note + continuation prompt) or end the run.
 * User messages queued meanwhile win — the run yields to the human.
 */
async function continueUltraWork(
  projectId: string,
  sessionId: string,
  entries: TranscriptEntry[],
  finalText: string,
  set: ChatSet,
  get: ChatGet
): Promise<void> {
  const store = useUltraWorkStore.getState()
  const run = store.get(sessionId)
  if (!run || run.status !== 'active') {
    processQueue(set, get, sessionId)
    return
  }
  // A human message waiting in the queue takes priority over auto-continue.
  if (get().queue.some((q) => q.sessionId === sessionId)) {
    processQueue(set, get, sessionId)
    return
  }
  setSessionStreamingFlags(set, get, sessionId, true)
  let decision
  try {
    decision = await decideAfterTurn(run, finalText, entries, (goal, e) => evaluateGoal(goal, e, sessionId))
  } catch {
    decision = { action: 'end' as const, status: 'unmet' as const, reason: 'Evaluator failed.' }
  }
  setSessionStreamingFlags(set, get, sessionId, false)
  // Stopped by the user while the evaluator was thinking.
  const latest = useUltraWorkStore.getState().get(sessionId)
  if (!latest || latest.status !== 'active') {
    processQueue(set, get, sessionId)
    return
  }
  if (decision.action === 'end') {
    useUltraWorkStore.getState().update(sessionId, {
      status: decision.status ?? 'unmet',
      endedAt: Date.now(),
      lastReason: decision.reason
    })
    if (decision.status === 'achieved' && !document.hasFocus()) {
      window.api?.notification?.send?.('Pawn · Ultra Work', i18n.t('ultraWork.notifyAchieved'))?.catch?.(() => {})
    }
    processQueue(set, get, sessionId)
    return
  }
  if (get().queue.some((q) => q.sessionId === sessionId)) {
    processQueue(set, get, sessionId)
    return
  }
  useUltraWorkStore.getState().update(sessionId, { iteration: latest.iteration + 1, lastReason: decision.reason })
  get().sendMessage(projectId, sessionId, decision.prompt || '', 'steer')
}

export function processQueue(set: ChatSet, get: ChatGet, preferSessionId?: string): void {
  const { queue } = get()
  if (queue.length === 0) return

  // Prefer the next item for the session that just finished; else any session
  // that is not currently streaming.
  let idx = -1
  if (preferSessionId) {
    idx = queue.findIndex(
      (q) => q.sessionId === preferSessionId && !get().streamingSessionIds.includes(q.sessionId)
    )
  }
  if (idx < 0) {
    idx = queue.findIndex((q) => !get().streamingSessionIds.includes(q.sessionId))
  }
  if (idx < 0) return

  const next = queue[idx]
  set((s) => ({ queue: s.queue.filter((_, i) => i !== idx) }))

  setTimeout(() => {
    // A newer message grabbed the turn while we waited (e.g. steer right after
    // Stop). Keep the item queued instead of starting a second concurrent loop.
    if (get().streamingSessionIds.includes(next.sessionId)) {
      set((s) => ({ queue: [next, ...s.queue] }))
      return
    }
    // The bubble was rendered when the message was queued; going back through
    // sendMessage would render it a second time.
    if (!next.displayed) {
      get().sendMessage(next.projectId, next.sessionId, next.content, 'queue', next.attachments)
      return
    }
    autoTitle(next.projectId, next.sessionId, next.content)
    const epoch = bumpSessionEpoch(next.sessionId)
    setSessionStreamingFlags(set, get, next.sessionId, true)
    void agentLoop(next.projectId, next.sessionId, next.content, set, get, next.attachments, epoch)
  }, 50)
}
