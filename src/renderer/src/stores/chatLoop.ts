import {
  acquireSleepHold, autoTitle, bumpSessionEpoch, getSessionEpoch, releaseSleepHold,
  sessionControllers, setSessionStreamingFlags, type ChatGet, type ChatSet
} from './chatState'
import {
  checkpointSnapshot, currentMessageContent, demoteVisionPayloadsToText, loadTranscript,
  persistTranscript, systemError, ToolLoopCounter, truncateToolResult
} from './chatTranscript'
import { useAppStore } from './app'
import { useChangeLedger } from './changeLedger'
import { usePrefsStore } from './prefs'
import { useProviderStore } from './provider'
import { useRoutineStore } from './routine'
import { useUsageStore } from './usage'
import { clearTurnCheckpoint, type AgentTurnCheckpoint } from './turnCheckpoint'
import { executeTool, TOOL_SAFETY, type ToolCall, type ToolResult } from '../agent/tools'
import { runProjectChecks } from '../agent/runChecks'
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
import { callLLM, type LlmResult } from '../agent/llm'
import { SYSTEM_PROMPT } from '../agent/prompts'
import { fireHook } from '../agent/hooksClient'
import { filterEnabledSkills } from '../utils/skillVisibility'
import { buildTranscriptText, imageAttachments, type ChatAttachment } from '../utils/attachments'
import i18n from '../i18n'

/** Hard ceiling on LLM rounds per user message; runaway agents die here. */
const MAX_TOOL_ROUNDS = 50
/** Consecutive identical tool-call sets before we call it a loop and stop. */
const MAX_REPEATED_TOOL_ROUNDS = 3
/** Model attempts per round before the turn gives up (each on a different model). */
const MAX_ROUTE_ATTEMPTS = 3
/** Compact once the replayed transcript passes this share of the model's context. */
const COMPACT_AT_RATIO = 0.6
const DEFAULT_CONTEXT_WINDOW = 128_000

// --- Agent loop -------------------------------------------------------------

async function checkSpendBudget(sessionId: string): Promise<string | null> {
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
      const rows = await window.api.db.getUsageSummary(startOfDay)
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
    const next = compactTranscript(entries)
    const after = estimateTokens(next)
    if (after >= before * 0.95) {
      // Already compact — still refresh meter
      useUsageStore.getState().noteContext(sessionId, after, DEFAULT_CONTEXT_WINDOW, true)
      return false
    }
    persistTranscript(sessionId, next, '', undefined)
    useUsageStore.getState().noteContext(sessionId, after, DEFAULT_CONTEXT_WINDOW, true)
    useUsageStore
      .getState()
      .noteDiagnostic(sessionId, 'info', i18n.t('chat.diagnostics.compactedManual'))
    return true
  } catch {
    return false
  }
}

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
    systemError(projectId, sessionId, i18n.t('chat.errors.noProvider'))
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
  /** Code mutations this user turn — drives free local typecheck auto-verify. */
  let turnHadCodeEdits = resumeFrom?.turnHadCodeEdits ?? false
  let turnRanChecks = resumeFrom?.turnRanChecks ?? false
  let autoVerifyDone = resumeFrom?.autoVerifyDone ?? false
  let consecutiveToolErrors = resumeFrom?.consecutiveToolErrors ?? 0
  let emptyResponses = resumeFrom?.emptyResponses ?? 0
  let round = resumeFrom?.round ?? 0
  const complexity: Complexity = resumeFrom?.complexity ?? estimateComplexity(userContent)
  let userMessageAppended = resumeFrom?.userMessageAppended ?? false
  /** completed | aborted | failed — failed leaves checkpoint for cold resume. */
  let turnEnd: 'completed' | 'aborted' | 'failed' = 'completed'

  try {
    const project = useAppStore.getState().projects.find((p) => p.id === projectId)
    const projectPaths = (project?.paths || []).filter(Boolean)
    const session = project?.sessions.find((s) => s.id === sessionId)
    // Selected multi-root path (session.path) wins over primary paths[0].
    const projectPath =
      (session?.path && projectPaths.includes(session.path) ? session.path : null) ||
      projectPaths[0]
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
        'When ready to implement, ask the user to switch to Build (or call app_set_agent_mode build if allowed).'
    }
    // Long-term Memory injection (local, optional)
    try {
      if (window.api.memory?.injectBlock) {
        const mem = await window.api.memory.injectBlock({
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
      entries.push({
        role: 'user',
        content: buildTranscriptText(userContent, attachments),
        ...(imgs.length > 0 ? { attachments: imgs } : {})
      })
      userMessageAppended = true
    }

    let lastDecision: RouteDecision | null = null
    const loopCounter = new ToolLoopCounter(MAX_REPEATED_TOOL_ROUNDS)

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

    while (round < MAX_TOOL_ROUNDS) {
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
      const contextWindow = lastDecision?.model.contextWindow || DEFAULT_CONTEXT_WINDOW
      const tokenEst = estimateTokens(entries)
      useUsageStore.getState().noteContext(sessionId, tokenEst, contextWindow, false)
      if (tokenEst > contextWindow * COMPACT_AT_RATIO) {
        entries = compactTranscript(entries)
        persistTranscript(sessionId, entries, lastDecision?.key || '', lastDecision?.tier)
        useUsageStore.getState().noteDiagnostic(sessionId, 'info', i18n.t('chat.diagnostics.compacted'))
        useUsageStore
          .getState()
          .noteContext(sessionId, estimateTokens(entries), contextWindow, true)
      }

      const escalate = shouldEscalate({ consecutiveToolErrors, round, emptyResponses })
      const excluded = new Set<string>()
      let transientFailures = 0
      let result: LlmResult | null = null
      let decision: RouteDecision | null = null

      let needsVision = transcriptNeedsVision(entries)

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
          needsVision
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

        const assistantMsgId = `${Date.now()}-assistant-${round}-${attempt}`
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: assistantMsgId, role: 'assistant', content: '', createdAt: Date.now()
        })

        try {
         result = await callLLM({
            decision, entries, systemLayers, projectPreamble, sessionId, projectId, projectPath, assistantMsgId, signal,
            complexity
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
            systemError(projectId, sessionId, i18n.t('chat.errors.allAttemptsFailed', { error: message }))
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
          systemError(projectId, sessionId, i18n.t(detailKey))
        } else {
          systemError(projectId, sessionId, i18n.t('chat.errors.noUsableModel'))
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
        // results back and continue so the agent can fix. Only auto/yolo (ask would
        // spam permission prompts). No paid services.
        const { permissionMode: perm, doneGate } = useProviderStore.getState()
        const agentMode = useProviderStore.getState().agentModeFor(sessionId)
        const gateKind = doneGate === 'test' ? 'test' : doneGate === 'typecheck' ? 'typecheck' : null
        const canAuto =
          agentMode === 'build' &&
          gateKind != null &&
          (perm === 'auto' || perm === 'yolo') &&
          !!toolCwd &&
          turnHadCodeEdits &&
          !turnRanChecks &&
          !autoVerifyDone &&
          !signal.aborted
        if (canAuto && gateKind) {
          autoVerifyDone = true
          try {
            const checkText = await runProjectChecks(toolCwd, gateKind, 90)
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
          }
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
      const safe: ToolCall[] = []
      const risky: ToolCall[] = []
      for (const tc of result.toolCalls) {
        (TOOL_SAFETY[tc.name] === 'safe' ? safe : risky).push(tc)
      }

      const resultsById = new Map<string, ToolResult>()
      if (safe.length > 0 && !signal.aborted) {
        const settled = await Promise.all(
          safe.map((tc) => executeTool(tc, toolCwd, signal, { sessionId, projectId }))
        )
        safe.forEach((tc, i) => resultsById.set(tc.id, settled[i]))
      }
      for (const tc of risky) {
        if (signal.aborted) break
        resultsById.set(tc.id, await executeTool(tc, toolCwd, signal, { sessionId, projectId }))
      }

      // Always record tool results for completed work. On abort, still persist
      // what finished so the next turn knows about side effects (writes, etc.).
      let roundErrors = 0
      for (const tc of result.toolCalls) {
        const raw = resultsById.get(tc.id) ?? {
          toolCallId: tc.id,
          content: signal.aborted
            ? 'Tool was not executed (run aborted).'
            : 'Tool produced no result.',
          isError: true
        }
        if (raw.isError) roundErrors++
        const truncated = truncateToolResult(raw, tc.name)

        if (!raw.isError && (tc.name === 'edit_file' || tc.name === 'write_file' || tc.name === 'delete_file')) {
          turnHadCodeEdits = true
        }
        if (tc.name === 'run_checks' && !raw.isError) {
          turnRanChecks = true
        }

        const toolMsgId = `${Date.now()}-tool-${tc.id}`
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: toolMsgId,
          role: 'system',
          content: formatToolMessageContent(tc.name, raw.isError === true, truncated, raw.diffData),
          createdAt: Date.now()
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

    if (round >= MAX_TOOL_ROUNDS) {
      systemError(projectId, sessionId, i18n.t('chat.errors.maxRounds', { rounds: MAX_TOOL_ROUNDS }))
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
    // Turn finished (normally or aborted) — drop the AI cursor so it doesn't
    // linger on the browser page after browser control ends.
    // Release the browser claim when this turn ends. The claim is a no-op
    // today (per-owner tabs supersede it), kept for renderer call-site compat.
    void window.api.browser?.release?.(sessionId)?.catch?.(() => {})
    if (get().streamingSessionIds.length <= 1) {
      void window.api.browser?.hideCursor?.()?.catch?.(() => {})
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
      // All work done (nothing streaming, nothing queued): hide the browser
      // panel the agent opened this turn. Hiding keeps the page alive (destroy
      // happens only on an explicit close); the panel stays open while other
      // work remains, and a panel the user opened themselves is never touched
      // (the marker is set only when the agent's open actually took effect).
      if (get().streamingSessionIds.length === 0 && get().queue.length === 0) {
        const w = window as unknown as {
          __agentOpenedBrowserPanel?: boolean
          __hideRightPanel?: () => void
        }
        if (w.__agentOpenedBrowserPanel) {
          w.__agentOpenedBrowserPanel = false
          try { w.__hideRightPanel?.() } catch { /* optional */ }
        }
      }
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
      if (!aborted && window.api.memory?.ingestTurn && entries.length > 0) {
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
          void window.api.memory.ingestTurn({
            projectId: projectId && projectId !== '__general__' ? projectId : null,
            sessionId,
            messages: recent
          }).catch(() => {})
          // Quiet merge of near-duplicate cards (threshold 0.92) so memory deepens over time.
          if (
            useProviderStore.getState().autoMemoryConsolidate &&
            window.api.memory?.consolidate
          ) {
            void window.api.memory.consolidate({
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
      // Drain the queue even after a manual stop: queued messages were
      // explicitly scheduled and must not wait for the next user input.
      processQueue(set, get, sessionId)
    }
  }
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

