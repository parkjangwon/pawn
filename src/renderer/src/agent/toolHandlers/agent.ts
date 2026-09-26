import i18n from '../../i18n'
import { formatAnswerForModel, useQuestionStore, type QuestionOption } from '../../stores/userQuestions'
import { TOOLS } from '../toolDefinitions'
import {
  TOOL_GROUP_IDS,
  connectionForGroup,
  describeToolGroup,
  groupOfTool,
  isGroupAvailable,
  parseToolGroupArgs,
  refreshConnectedProviders
} from '../toolsets'
import { readSkill } from '../skills'
import { installSkillFromRepo } from '../skillInstaller'
import { resolveToolPath } from '../pathUtils'
import { usePlanStore } from '../../stores/plan'
import { runProjectChecks } from '../runChecks'
import { searchCodebase } from '../codebaseSearch'
import { listArtifacts, listArtifactsDir, writeArtifact, writeArtifactTo, defaultArtifactsDir } from '../artifacts'
import { buildRepoMap } from '../repoMap'
import {
  buildIssuePrPlaybook,
  parseIssuePrArg,
  prefetchIssueContext
} from '../issueWorkflow'
import {
  formatSubagentResults,
  listAgentCatalog,
  normalizeSubagentTask,
  runParallelSubagents,
  runSubagent,
  spawnBackgroundSubagent,
  type SubagentIsolation,
  type SubagentTask
} from '../subagent'
import { runResearchReport } from '../researchReport'
import type { AgentApplyMode, AgentThoroughness } from '../agentProfiles'
import {
  useSubagentRunsStore,
  waitForSubagentRun,
  waitForSessionSubagents
} from '../../stores/subagentRuns'
import { useProviderStore } from '../../stores/provider'
import { effectivePoolLimit, harnessProfile } from '../harnessMode'
import type { ToolHandler } from './types'

function parseIsolation(raw: unknown): SubagentIsolation | undefined {
  const s = String(raw || '')
  if (s === 'worktree' || s === 'none') return s
  return undefined
}

function parseApply(raw: unknown): AgentApplyMode | undefined {
  const s = String(raw || '')
  if (s === 'auto' || s === 'none' || s === 'review') return s
  return undefined
}

function parseThoroughness(raw: unknown): AgentThoroughness | undefined {
  const s = String(raw || '')
  if (s === 'quick' || s === 'medium' || s === 'very_thorough' || s === 'very-thorough') {
    return s === 'very-thorough' ? 'very_thorough' : (s as AgentThoroughness)
  }
  return undefined
}

function parseDependsOn(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const list = raw.map(String).map((s) => s.trim()).filter(Boolean)
    return list.length ? list : undefined
  }
  if (typeof raw === 'string' && raw.trim()) {
    const list = raw
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean)
    return list.length ? list : undefined
  }
  return undefined
}

function taskFromArgs(row: Record<string, unknown>, index?: number): SubagentTask {
  return {
    prompt: String(row.prompt || ''),
    name: row.name ? String(row.name) : index !== undefined ? `task-${index + 1}` : undefined,
    agent: row.agent ? String(row.agent) : undefined,
    mode: row.mode ? String(row.mode) : undefined,
    maxRounds: row.max_rounds !== undefined ? Number(row.max_rounds) : undefined,
    isolation: parseIsolation(row.isolation),
    apply: parseApply(row.apply),
    thoroughness: parseThoroughness(row.thoroughness),
    model: row.model ? String(row.model) : undefined,
    background: row.background === true || row.background === 'true',
    dependsOn: parseDependsOn(row.depends_on ?? row.dependsOn),
    sharedContext:
      row.shared_context != null
        ? String(row.shared_context)
        : row.sharedContext != null
          ? String(row.sharedContext)
          : undefined
  }
}


const update_plan: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const sessionId = ctx?.sessionId
        if (!sessionId) {
          return { toolCallId: call.id, content: 'No active session for plan', isError: true }
        }
        const rawItems = call.arguments.items
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
          return { toolCallId: call.id, content: 'items must be a non-empty array', isError: true }
        }
        const items = rawItems.map((it) => {
          const row = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
          return {
            id: typeof row.id === 'string' ? row.id : undefined,
            content: String(row.content || ''),
            status: (row.status as 'pending' | 'in_progress' | 'done' | 'cancelled') || 'pending'
          }
        }).filter((it) => it.content.trim())
        const next = usePlanStore.getState().updatePlan(sessionId, items)
        const lines = next.map((it) => `- [${it.status}] ${it.content}`)
        return { toolCallId: call.id, content: `Plan updated (${next.length} items):\n${lines.join('\n')}` }
      }


const run_checks: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const kindRaw = String(call.arguments.kind || 'all')
        const kind = (['all', 'typecheck', 'test', 'lint', 'build'].includes(kindRaw)
          ? kindRaw
          : 'all') as 'all' | 'typecheck' | 'test' | 'lint' | 'build'
        const timeout = call.arguments.timeout !== undefined ? Number(call.arguments.timeout) : 120
        const text = await runProjectChecks(workDir, kind, timeout)
        return { toolCallId: call.id, content: text }
      }


const codebase_search: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const root = resolveToolPath(
          (call.arguments.rootPath as string) || projectPath || '',
          projectPath
        )
        if (!root || root === '.') {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const text = await searchCodebase(root, String(call.arguments.query || ''), {
          maxResults:
            call.arguments.max_results !== undefined ? Number(call.arguments.max_results) : undefined,
          pathGlob: call.arguments.path_glob ? String(call.arguments.path_glob) : undefined
        })
        return { toolCallId: call.id, content: text, isError: text.startsWith('query is required') }
      }


const write_artifact: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const name = String(call.arguments.name || '')
        const content = String(call.arguments.content ?? '')
        let res: { ok: boolean; path?: string; error?: string }
        if (projectPath) {
          res = await writeArtifact(projectPath, name, content)
        } else {
          // No open project: fall back to <downloads>/pawn-artifacts so reports
          // and exports still land somewhere the user can find them.
          const dir = await defaultArtifactsDir()
          if (!dir) {
            return {
              toolCallId: call.id,
              content: 'No project path set and no default artifacts directory available',
              isError: true
            }
          }
          res = await writeArtifactTo(dir, name, content)
        }
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'write failed', isError: true }
        return { toolCallId: call.id, content: `Wrote artifact: ${res.path}` }
      }


const list_artifacts: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const sub = call.arguments.subdir ? String(call.arguments.subdir) : ''
        if (projectPath) {
          return { toolCallId: call.id, content: await listArtifacts(projectPath, sub) }
        }
        const dir = await defaultArtifactsDir()
        if (!dir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        return { toolCallId: call.id, content: await listArtifactsDir(dir, sub) }
      }


const MAX_QUESTION_OPTIONS = 6

function normalizeOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return []
  const out: QuestionOption[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const label =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { label?: unknown }).label === 'string'
          ? (item as { label: string }).label
          : ''
    const clean = label.trim().slice(0, 120)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    const description =
      item && typeof item === 'object' && typeof (item as { description?: unknown }).description === 'string'
        ? (item as { description: string }).description.trim().slice(0, 300) || undefined
        : undefined
    out.push({ label: clean, ...(description ? { description } : {}) })
    if (out.length >= MAX_QUESTION_OPTIONS) break
  }
  return out
}

const ask_user: ToolHandler = async (call, _projectPath, signal, ctx) => {
  if (ctx?.subagent || !ctx?.sessionId) {
    return {
      toolCallId: call.id,
      content: 'ask_user is only available to the main agent. Make a reasonable assumption, state it in your result, and continue.',
      isError: true
    }
  }
  const question = String(call.arguments.question || '').trim().slice(0, 1000)
  if (!question) return { toolCallId: call.id, content: 'question is required', isError: true }
  const options = normalizeOptions(call.arguments.options)
  const allowOther = call.arguments.allow_other !== false || options.length === 0
  const q = {
    sessionId: ctx.sessionId,
    kind: 'question' as const,
    question,
    options,
    multiSelect: call.arguments.multi_select === true && options.length > 1,
    allowOther
  }
  const answer = await useQuestionStore.getState().ask(q, signal)
  return {
    toolCallId: call.id,
    content: formatAnswerForModel(q, answer),
    isError: answer.aborted === true
  }
}

const request_plan_approval: ToolHandler = async (call, _projectPath, signal, ctx) => {
  if (ctx?.subagent || !ctx?.sessionId) {
    return { toolCallId: call.id, content: 'request_plan_approval is only available to the main agent.', isError: true }
  }
  const sessionId = ctx.sessionId
  const provider = useProviderStore.getState()
  if (provider.agentModeFor(sessionId) !== 'plan') {
    return {
      toolCallId: call.id,
      content: 'Already in Build mode — no approval needed. Proceed with the implementation.'
    }
  }
  const plan = String(call.arguments.plan || '').trim().slice(0, 12_000)
  if (!plan) return { toolCallId: call.id, content: 'plan is required', isError: true }
  const APPROVE = i18n.t('questions.approveLabel')
  const REVISE = i18n.t('questions.reviseLabel')
  const answer = await useQuestionStore.getState().ask(
    {
      sessionId,
      kind: 'plan_approval',
      question: i18n.t('questions.planApprovalTitle'),
      details: plan,
      options: [{ label: APPROVE }, { label: REVISE }],
      multiSelect: false,
      allowOther: true
    },
    signal
  )
  if (answer.aborted) {
    return { toolCallId: call.id, content: 'The user stopped the turn before approving the plan.', isError: true }
  }
  const approved = answer.selected.includes(APPROVE)
  if (approved) {
    useProviderStore.getState().setAgentMode('build', sessionId)
    const note = answer.text?.trim() ? `\nUser note: ${answer.text.trim()}` : ''
    return {
      toolCallId: call.id,
      content:
        'Plan approved. The session is now in Build mode: file edits, shell, and other mutating tools are available from your next step. ' +
        'Implement the plan now, keep update_plan statuses current, and verify with run_checks.' +
        note
    }
  }
  const feedback = answer.text?.trim()
  return {
    toolCallId: call.id,
    content: answer.dismissed
      ? 'The user closed the approval without deciding. Stay in Plan mode; summarize the plan and stop.'
      : `The user wants changes before approving.${feedback ? `\nFeedback: ${feedback}` : ''}\nRevise the plan (still in Plan mode) and call request_plan_approval again.`
  }
}

const load_tools: ToolHandler = async (call) => {
  const groups = parseToolGroupArgs(call.arguments.groups)
  if (groups.length === 0) {
    return {
      toolCallId: call.id,
      content: `No valid groups. Choose from: ${TOOL_GROUP_IDS.join(', ')}.`,
      isError: true
    }
  }
  const connected = await refreshConnectedProviders()
  const loaded: string[] = []
  const blocked: string[] = []
  for (const g of groups) {
    const names = TOOLS.filter((t) => groupOfTool(t.name)?.id === g).map((t) => t.name)
    if (!isGroupAvailable(g, connected)) {
      blocked.push(
        `${g}: account not connected — ask the user to connect ${connectionForGroup(g)} in Settings → Connections.`
      )
      continue
    }
    loaded.push(`${g} (${describeToolGroup(g)}): ${names.join(', ')}`)
  }
  const parts: string[] = []
  if (loaded.length) parts.push(`Loaded — callable from your next step:\n${loaded.map((l) => `- ${l}`).join('\n')}`)
  if (blocked.length) parts.push(`Not loaded:\n${blocked.map((b) => `- ${b}`).join('\n')}`)
  return { toolCallId: call.id, content: parts.join('\n\n'), isError: loaded.length === 0 }
}

const load_skill: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const name = call.arguments.name as string
        const content = await readSkill(projectPath, name)
        if (!content) return { toolCallId: call.id, content: `No skill named "${name}". Check the Available Skills list.`, isError: true }
        return { toolCallId: call.id, content }
      }


const install_skill: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const repo = String(call.arguments.repo ?? '').trim()
        const scope = call.arguments.scope === 'project' ? 'project' : 'user'
        const res = await installSkillFromRepo(repo, scope, projectPath)
        return { toolCallId: call.id, content: res.content, isError: res.isError === true }
      }

const repo_map: ToolHandler = async (call, projectPath, _signal, _ctx, _api) => {
  const root = resolveToolPath(
    (call.arguments.rootPath as string) || projectPath || '',
    projectPath
  )
  if (!root || root === '.') {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const maxFiles =
    call.arguments.max_files !== undefined ? Number(call.arguments.max_files) : undefined
  const { text, fileCount, fromCache } = await buildRepoMap(root, { maxFiles })
  if (!fileCount) {
    return { toolCallId: call.id, content: text || 'No source files found', isError: !text }
  }
  return {
    toolCallId: call.id,
    content: fromCache ? `${text}\n\n(cache hit)` : text
  }
}

const issue_to_pr: ToolHandler = async (call, projectPath, _signal, _ctx, _api) => {
  const raw = String(call.arguments.issue || '').trim()
  const parsed = parseIssuePrArg(raw)
  if (!parsed) {
    return {
      toolCallId: call.id,
      content: 'Provide issue as #42, owner/repo#42, or a full issue URL',
      isError: true
    }
  }
  if (call.arguments.repo) parsed.repoHint = String(call.arguments.repo)
  // Prefetch when GitHub is connected — saves a full tool round.
  let prefetched: string | undefined
  try {
    prefetched = await prefetchIssueContext({
      issueRef: parsed.issueRef,
      repoHint: parsed.repoHint,
      projectPath
    })
  } catch {
    prefetched = undefined
  }
  const playbook = buildIssuePrPlaybook({ ...parsed, prefetched })
  return {
    toolCallId: call.id,
    content:
      playbook +
      `\n\nProject cwd: ${projectPath || '(none)'}\n` +
      (prefetched
        ? `Issue details were prefetched. Continue from local prep / implementation.`
        : `Begin step 1 now with the appropriate tools.`)
  }
}

const spawn_agent: ToolHandler = async (call, projectPath, signal, ctx, _api) => {
  if (ctx?.subagent) {
    return {
      toolCallId: call.id,
      content: 'Nested spawn_agent is not allowed inside a subagent. Finish your task and return a summary.',
      isError: true
    }
  }
  const prompt = String(call.arguments.prompt || '').trim()
  if (!prompt) {
    return { toolCallId: call.id, content: 'prompt is required', isError: true }
  }
  const task = normalizeSubagentTask(taskFromArgs(call.arguments as Record<string, unknown>))
  const projectId = ctx?.projectId || '__general__'
  const sessionId = ctx?.sessionId || 'subagent'

  if (task.background) {
    const handle = spawnBackgroundSubagent(task, { projectId, sessionId, projectPath })
    return {
      toolCallId: call.id,
      content:
        `Background subagent started.\n` +
        `- id: ${handle.runId}\n` +
        `- name: ${handle.name}\n` +
        `- agent: ${handle.agent}\n` +
        `It will post a system message when finished. Use await_agent id="${handle.runId}" (or name) to block, ` +
        `await_agent id="*" for all session runs, or cancel_agent to stop. Open the Agents panel for live status.`,
      isError: false
    }
  }

  const result = await runSubagent(task, {
    projectId,
    sessionId,
    projectPath,
    signal
  })
  return {
    toolCallId: call.id,
    content: formatSubagentResults([result]),
    isError: !result.ok
  }
}

const parallel_agents: ToolHandler = async (call, projectPath, signal, ctx, _api) => {
  if (ctx?.subagent) {
    return {
      toolCallId: call.id,
      content: 'parallel_agents is not allowed inside a subagent.',
      isError: true
    }
  }
  const raw = call.arguments.tasks
  if (!Array.isArray(raw) || raw.length === 0) {
    return { toolCallId: call.id, content: 'tasks must be a non-empty array', isError: true }
  }
  const tasks: SubagentTask[] = raw.slice(0, 6).map((t, i) => {
    const row = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    return taskFromArgs(row, i)
  })
  if (tasks.some((t) => !t.prompt.trim())) {
    return { toolCallId: call.id, content: 'Each task needs a non-empty prompt', isError: true }
  }
  const sharedContext =
    call.arguments.shared_context != null
      ? String(call.arguments.shared_context)
      : call.arguments.sharedContext != null
        ? String(call.arguments.sharedContext)
        : undefined
  const failRaw = String(
    call.arguments.on_dependency_fail || call.arguments.onDependencyFail || 'skip'
  ).toLowerCase()
  const onDependencyFail =
    failRaw === 'continue' || failRaw === 'stop' || failRaw === 'skip'
      ? (failRaw as 'continue' | 'stop' | 'skip')
      : 'skip'
  const results = await runParallelSubagents(tasks, {
    projectId: ctx?.projectId || '__general__',
    sessionId: ctx?.sessionId || 'subagent',
    projectPath,
    signal,
    sharedContext,
    onDependencyFail
  })
  const anyFail = results.some((r) => !r.ok)
  return {
    toolCallId: call.id,
    content: formatSubagentResults(results),
    isError: anyFail
  }
}

const list_agents: ToolHandler = async (call, projectPath, _signal, ctx, _api) => {
  const catalog = await listAgentCatalog(projectPath)
  const store = useSubagentRunsStore.getState()
  const sessionId = ctx?.sessionId
  const running = (sessionId ? store.activeForSession(sessionId) : store.runs.filter((r) => r.status === 'running')).slice(0, 16)
  const providerState = useProviderStore.getState()
  const harnessMode = providerState.harnessModeFor?.(sessionId) ?? 'default'
  const maxTasks = harnessProfile(harnessMode).maxParallelTasks
  const pool = effectivePoolLimit(providerState.maxParallelSubagents || 4, harnessMode)
  const lines = [
    `# Available subagents (${catalog.length})`,
    '',
    ...catalog.map((a) => {
      const bounds = [
        a.pathAllow?.length ? `pathAllow=${a.pathAllow.join('|')}` : '',
        a.pathDeny?.length ? `pathDeny×${a.pathDeny.length}` : '',
        a.maxEdits != null ? `maxEdits=${a.maxEdits}` : '',
        a.maxToolCalls != null ? `maxToolCalls=${a.maxToolCalls}` : ''
      ]
        .filter(Boolean)
        .join(', ')
      return (
        `- **${a.name}** (${a.source}) — model=${a.model}, isolation=${a.isolation}, maxTurns=${a.maxTurns}` +
        `${a.skills?.length ? `, skills=${a.skills.join('+')}` : ''}` +
        `${bounds ? ` · ${bounds}` : ''}\n  ${a.description}`
      )
    }),
    '',
    'Use spawn_agent with agent="<name>" (or parallel_agents tasks[].agent).',
    harnessMode === 'eco'
      ? `Eco mode: use parallel_agents only when work clearly splits (max ${maxTasks} tasks; pool=${pool} concurrent).`
      : harnessMode === 'maxing'
        ? `Maxing mode: split independent work aggressively with parallel_agents (max ${maxTasks} tasks; pool=${pool} concurrent).`
        : `Independent multi-module work: prefer parallel_agents (max ${maxTasks} tasks; pool=${pool} concurrent).`,
    'Pipelines: name tasks + depends_on + shared_context; later waves get sibling findings.',
    'background=true returns immediately; await_agent / cancel_agent manage runs.',
    'await_agent id="*" waits for all running session subagents; comma-separated ids also work.',
    'Custom agents: `.pawn/agents/*.md` or `.claude/agents/*.md` (also ~/.pawn|~/.claude/agents).'
  ]
  if (sessionId) {
    const tot = store.totalsForSession(sessionId)
    lines.push(
      '',
      `## This session`,
      `- running=${tot.running} ok=${tot.ok} failed=${tot.failed} · $${tot.cost.toFixed(4)} · cache ${(tot.cacheHitRate * 100).toFixed(0)}%`
    )
  }
  if (running.length) {
    lines.push('', `## Running now (${running.length})`)
    for (const r of running) {
      lines.push(
        `- ${r.id} · ${r.name} [${r.agent}] r${r.rounds}` +
          (r.lastTool ? ` · ${r.lastTool}` : '') +
          (r.background ? ' · bg' : '') +
          (r.batchId ? ` · batch=${r.batchId}` : '')
      )
    }
  }
  return { toolCallId: call.id, content: lines.join('\n') }
}

function abortableWait<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new Error('aborted'))
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  ])
}

function formatAwaitedRun(result: {
  name: string
  agent: string
  status: string
  rounds: number
  error?: string
  filesChanged?: string[]
  applyConflicts?: string[]
  summary?: string
  usage?: { cost: number; cacheHitRate: number; modelLabel?: string }
}): string {
  return (
    `Awaited ${result.name} [${result.agent}] — ${result.status}` +
    ` (rounds=${result.rounds})\n` +
    (result.error ? `error: ${result.error}\n` : '') +
    (result.filesChanged?.length ? `files: ${result.filesChanged.join(', ')}\n` : '') +
    (result.applyConflicts?.length
      ? `conflicts: ${result.applyConflicts.join(', ')}\n`
      : '') +
    (result.usage && result.usage.cost > 0
      ? `cost: $${result.usage.cost.toFixed(4)} · cache ${(result.usage.cacheHitRate * 100).toFixed(0)}%\n`
      : '') +
    `\n${(result.summary || '').slice(0, 12_000)}`
  )
}

const await_agent: ToolHandler = async (call, _projectPath, signal, ctx, _api) => {
  const id = String(call.arguments.id || '').trim()
  if (!id) {
    return { toolCallId: call.id, content: 'id is required', isError: true }
  }
  const timeoutMs = Math.min(
    30 * 60_000,
    Math.max(5_000, Math.floor(Number(call.arguments.timeout_ms) || 600_000))
  )
  try {
    // Wait for all running subagents in this session.
    if (id === '*' || id.toLowerCase() === 'all') {
      const sessionId = ctx?.sessionId
      if (!sessionId) {
        return { toolCallId: call.id, content: 'No session for await *', isError: true }
      }
      const results = await abortableWait(waitForSessionSubagents(sessionId, timeoutMs), signal)
      if (!results.length) {
        return { toolCallId: call.id, content: 'No running subagents in this session.' }
      }
      const body = results.map((r) => formatAwaitedRun(r)).join('\n\n---\n\n')
      const anyFail = results.some((r) => r.status === 'error' || r.status === 'aborted')
      return {
        toolCallId: call.id,
        content: `# Awaited ${results.length} subagent(s)\n\n${body}`.slice(0, 24_000),
        isError: anyFail
      }
    }

    // Comma-separated ids/names.
    const parts = id.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    if (parts.length > 1) {
      const results = await abortableWait(
        Promise.all(parts.map((p) => waitForSubagentRun(p, timeoutMs))),
        signal
      )
      const body = results.map((r) => formatAwaitedRun(r)).join('\n\n---\n\n')
      const anyFail = results.some((r) => r.status === 'error' || r.status === 'aborted')
      return {
        toolCallId: call.id,
        content: `# Awaited ${results.length} subagent(s)\n\n${body}`.slice(0, 24_000),
        isError: anyFail
      }
    }

    const result = await abortableWait(waitForSubagentRun(id, timeoutMs), signal)
    return {
      toolCallId: call.id,
      content: formatAwaitedRun(result),
      isError: result.status === 'error' || result.status === 'aborted'
    }
  } catch (err) {
    return {
      toolCallId: call.id,
      content: `await_agent failed: ${String(err)}`,
      isError: true
    }
  }
}

const research_report: ToolHandler = async (call, projectPath, signal, ctx, _api) => {
  if (ctx?.subagent) {
    return { toolCallId: call.id, content: 'research_report is not allowed inside a subagent.', isError: true }
  }
  const res = await runResearchReport({
    topic: String(call.arguments.topic ?? ''),
    aspects: Array.isArray(call.arguments.aspects)
      ? call.arguments.aspects.map((a) => String(a))
      : undefined,
    maxSources: call.arguments.max_sources != null ? Number(call.arguments.max_sources) : undefined,
    maxSubagents: call.arguments.max_subagents != null ? Number(call.arguments.max_subagents) : undefined,
    outputPath: call.arguments.output_path != null ? String(call.arguments.output_path) : undefined,
    projectPath,
    projectId: ctx?.projectId,
    sessionId: ctx?.sessionId,
    signal
  })
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  const aspects = res.aspects?.length ? `\nAspects: ${res.aspects.join(' | ')}` : ''
  const workers = res.research?.length ?? 0
  const fails = res.research?.filter((r) => !r.ok).length ?? 0
  return {
    toolCallId: call.id,
    content: `Research report complete (${workers} parallel workers, ${fails} failed).${aspects}\n\n${res.report || '(no report)'}`,
    isError: !res.ok
  }
}

const cancel_agent: ToolHandler = async (call, _projectPath, _signal, ctx, _api) => {
  const id = String(call.arguments.id || '').trim()
  if (!id) {
    return { toolCallId: call.id, content: 'id is required', isError: true }
  }
  const store = useSubagentRunsStore.getState()
  if (id === '*') {
    const sessionId = ctx?.sessionId
    if (!sessionId) {
      return { toolCallId: call.id, content: 'No session for cancel *', isError: true }
    }
    const n = store.cancelAllForSession(sessionId)
    return {
      toolCallId: call.id,
      content: `Cancelled ${n} running subagent(s) for this session.`
    }
  }
  const run = store.getById(id) || store.findRunning(id) || store.runs.find((r) => r.name === id)
  if (!run) {
    return { toolCallId: call.id, content: `No subagent found for id/name: ${id}`, isError: true }
  }
  if (run.status !== 'running') {
    return {
      toolCallId: call.id,
      content: `Subagent ${run.id} is already ${run.status}`
    }
  }
  const ok = store.cancel(run.id)
  return {
    toolCallId: call.id,
    content: ok
      ? `Cancelled subagent ${run.id} (${run.name})`
      : `Could not cancel ${run.id}`,
    isError: !ok
  }
}

export const agentHandlers: Record<string, ToolHandler> = {
  update_plan,
  run_checks,
  codebase_search,
  write_artifact,
  list_artifacts,
  ask_user,
  request_plan_approval,
  load_tools,
  load_skill,
  install_skill,
  repo_map,
  issue_to_pr,
  spawn_agent,
  parallel_agents,
  research_report,
  list_agents,
  await_agent,
  cancel_agent
}
