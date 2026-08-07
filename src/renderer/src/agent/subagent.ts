/**
 * Nested agent runner for spawn_agent / parallel_agents.
 * Optional git worktree isolation for worker mode; live run registry for UI.
 */
import { callLLM } from './llm'
import { executeTool } from './toolExecutor'
import { TOOL_SAFETY } from './toolPermission'
import { route, setSessionRoute, estimateComplexity, type RouteDecision } from './router'
import { SYSTEM_PROMPT } from './prompts'
import { estimateTokens, type TranscriptEntry } from './transcript'
import type { ToolCall, ToolResult } from './toolDefinitionsTypes'
import { useUsageStore } from '../stores/usage'
import { useSubagentRunsStore } from '../stores/subagentRuns'
import { uid } from '../utils/uid'

export type SubagentMode = 'explore' | 'worker'
export type SubagentIsolation = 'none' | 'worktree'

export type SubagentTask = {
  name?: string
  prompt: string
  mode?: SubagentMode
  maxRounds?: number
  /** worker default: worktree when git repo; explore default: none */
  isolation?: SubagentIsolation
}

export type SubagentResult = {
  name: string
  ok: boolean
  summary: string
  rounds: number
  toolsUsed: string[]
  error?: string
  isolation?: SubagentIsolation
  worktreePath?: string
}

const MAX_NESTING = 2
const DEFAULT_MAX_ROUNDS = 12
const HARD_MAX_ROUNDS = 25
/** Soft budget: parallel subagents should not explode token use. */
export const MAX_PARALLEL_SUBAGENTS = 6

const EXPLORE_ALLOW = new Set([
  'read_file',
  'read_spreadsheet',
  'list_dir',
  'search_files',
  'grep_search',
  'codebase_search',
  'repo_map',
  'git_status',
  'git_diff',
  'git_log',
  'git_pr_ready',
  'web_search',
  'web_fetch',
  'web_research',
  'memory_search',
  'memory_list',
  'load_skill',
  'run_checks',
  'list_artifacts',
  'update_plan',
  'terminal_list',
  'terminal_read',
  'google_whoami',
  'google_drive_search',
  'google_drive_read',
  'google_gmail_search',
  'google_gmail_read',
  'google_calendar_list',
  'google_tasks_list',
  'google_sheets_read',
  'google_docs_read',
  'google_slides_read',
  'github_whoami',
  'github_list_repos',
  'github_get_repo',
  'github_list_issues',
  'github_get_issue',
  'github_list_pulls',
  'github_get_pull',
  'github_review_pull',
  'github_list_commits',
  'github_get_file',
  'github_search_code',
  'github_search_issues',
  'gitlab_whoami',
  'gitlab_list_projects',
  'gitlab_get_project',
  'gitlab_list_issues',
  'gitlab_get_issue',
  'gitlab_list_merge_requests',
  'gitlab_get_merge_request',
  'gitlab_list_commits',
  'gitlab_get_file',
  'gitlab_search',
  'codecommit_whoami',
  'codecommit_list_repos',
  'codecommit_get_repo',
  'codecommit_list_branches',
  'codecommit_get_branch',
  'codecommit_list_commits',
  'codecommit_get_file'
])

const WORKER_DENY = new Set([
  'spawn_agent',
  'parallel_agents',
  'app_set_permission_mode',
  'app_create_automation',
  'computer_click',
  'computer_move',
  'computer_drag',
  'computer_scroll',
  'computer_type',
  'computer_keypress',
  'computer_clipboard'
])

let nestingDepth = 0

export function getSubagentDepth(): number {
  return nestingDepth
}

export function isSubagentToolAllowed(name: string, mode: SubagentMode): boolean {
  if (name.startsWith('mcp__')) return mode === 'worker'
  if (mode === 'explore') return EXPLORE_ALLOW.has(name)
  return !WORKER_DENY.has(name)
}

function subagentSystem(mode: SubagentMode, taskName: string, isolation: SubagentIsolation): string {
  return (
    SYSTEM_PROMPT +
    `\n\n## Subagent mode (${mode}, isolation=${isolation})\n` +
    `You are a focused subagent named "${taskName}". Complete ONLY the assigned task.\n` +
    `- Do not chat with the user; return findings via your final text answer.\n` +
    (mode === 'explore'
      ? `- Explore mode: read/search/inspect only. Do not edit, shell-write, commit, or spawn agents.\n`
      : `- Worker mode: implement the task with tools. Do not spawn nested agents.\n`) +
    (isolation === 'worktree'
      ? `- You are in an isolated git worktree. Edit freely; the parent will see a diff summary.\n`
      : '') +
    `- When finished, write a concise summary: what you found/changed, files touched, residual risks.`
  )
}

async function maybeCreateWorktree(
  projectPath: string | undefined,
  runId: string,
  isolation: SubagentIsolation
): Promise<{ cwd?: string; worktreePath?: string; branch?: string; note?: string }> {
  if (isolation !== 'worktree' || !projectPath || !window.api?.worktree?.create) {
    return { cwd: projectPath }
  }
  const res = await window.api.worktree.create(projectPath, runId)
  if (!res?.ok || !res.path) {
    return {
      cwd: projectPath,
      note: `worktree unavailable (${res?.error || 'unknown'}); using shared cwd`
    }
  }
  return { cwd: res.path, worktreePath: res.path, branch: res.branch }
}

/**
 * Run one nested agent loop. Does not append to the parent chat transcript.
 */
export async function runSubagent(
  task: SubagentTask,
  opts: {
    projectId: string
    sessionId: string
    projectPath?: string
    signal?: AbortSignal
  }
): Promise<SubagentResult> {
  const name = (task.name || 'subagent').slice(0, 80)
  const mode: SubagentMode = task.mode === 'worker' ? 'worker' : 'explore'
  const isolation: SubagentIsolation =
    task.isolation ||
    (mode === 'worker' ? 'worktree' : 'none')
  const maxRounds = Math.min(
    HARD_MAX_ROUNDS,
    Math.max(1, Math.floor(task.maxRounds || DEFAULT_MAX_ROUNDS))
  )
  const runId = uid('subrun-')

  if (!task.prompt?.trim()) {
    return { name, ok: false, summary: '', rounds: 0, toolsUsed: [], error: 'prompt is required' }
  }
  if (nestingDepth >= MAX_NESTING) {
    return {
      name,
      ok: false,
      summary: '',
      rounds: 0,
      toolsUsed: [],
      error: `Max subagent nesting depth (${MAX_NESTING}) reached`
    }
  }

  nestingDepth++
  const toolsUsed: string[] = []
  let rounds = 0
  const signal = opts.signal || new AbortController().signal
  let worktreePath: string | undefined
  let worktreeBranch: string | undefined
  let toolCwd = opts.projectPath

  useSubagentRunsStore.getState().start({
    id: runId,
    name,
    mode,
    parentSessionId: opts.sessionId,
    isolation,
    worktreePath: undefined
  })

  const finish = (
    result: SubagentResult
  ): SubagentResult => {
    useSubagentRunsStore.getState().finish(runId, {
      status: result.ok ? (signal.aborted ? 'aborted' : 'ok') : 'error',
      summary: result.summary,
      error: result.error,
      rounds: result.rounds,
      toolsUsed: result.toolsUsed
    })
    return result
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

    let entries: TranscriptEntry[] = [
      {
        role: 'user',
        content:
          task.prompt.trim() +
          (wt.note ? `\n\n(Note: ${wt.note})` : '')
      }
    ]
    const complexity = estimateComplexity(task.prompt)
    const systemLayers = [subagentSystem(mode, name, isolation)]
    const projectPreamble = toolCwd
      ? `--- Working Directory ---\n${toolCwd}\nYou are a subagent; stay on task.`
      : 'You are a subagent; stay on task.'

    while (rounds < maxRounds) {
      if (signal.aborted) {
        return finish({
          name,
          ok: false,
          summary: 'Aborted',
          rounds,
          toolsUsed,
          error: 'aborted',
          isolation,
          worktreePath
        })
      }
      rounds++
      useSubagentRunsStore.getState().tick(runId, { rounds, toolsUsed: [...toolsUsed] })

      const decision: RouteDecision | null = route({
        sessionId: opts.sessionId,
        entries,
        complexity,
        escalate: 0,
        exclude: new Set(),
        newTurn: rounds === 1,
        needsVision: false
      })
      if (!decision) {
        return finish({
          name,
          ok: false,
          summary: '',
          rounds,
          toolsUsed,
          error: 'No model available to run subagent',
          isolation,
          worktreePath
        })
      }

      const assistantMsgId = `sub-${Date.now()}-${rounds}`
      let result
      try {
        result = await callLLM({
          decision,
          entries,
          systemLayers,
          projectPreamble,
          sessionId: opts.sessionId,
          projectId: opts.projectId,
          projectPath: toolCwd,
          assistantMsgId,
          signal,
          complexity,
          toolAllowlist: mode === 'explore' ? [...EXPLORE_ALLOW] : undefined,
          toolDenylist: mode === 'worker' ? [...WORKER_DENY] : undefined
        })
        useUsageStore.getState().record(opts.sessionId, decision.model, result.usage)
        if (!decision.ephemeral) {
          setSessionRoute(opts.sessionId, decision.key, decision.tier, estimateTokens(entries))
        }
      } catch (err) {
        return finish({
          name,
          ok: false,
          summary: '',
          rounds,
          toolsUsed,
          error: String(err),
          isolation,
          worktreePath
        })
      }

      entries.push({
        role: 'assistant',
        content: result.text,
        ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
        ...(result.reasoningContent != null ? { reasoningContent: result.reasoningContent } : {})
      })

      if (!result.toolCalls.length) {
        let summary = (result.text || '').trim() || '(no summary)'
        if (worktreePath && window.api?.worktree?.diffStat) {
          const diff = await window.api.worktree.diffStat(worktreePath)
          if (diff) summary += `\n\n### Worktree diff\n${diff}`
        }
        return finish({
          name,
          ok: true,
          summary: summary.slice(0, 12_000),
          rounds,
          toolsUsed,
          isolation,
          worktreePath
        })
      }

      const safe: ToolCall[] = []
      const risky: ToolCall[] = []
      for (const tc of result.toolCalls) {
        if (!isSubagentToolAllowed(tc.name, mode)) {
          risky.push(tc)
          continue
        }
        ;(TOOL_SAFETY[tc.name] === 'safe' ? safe : risky).push(tc)
      }

      const resultsById = new Map<string, ToolResult>()
      if (safe.length && !signal.aborted) {
        const settled = await Promise.all(
          safe.map((tc) =>
            executeTool(tc, toolCwd, signal, {
              sessionId: opts.sessionId,
              subagent: true
            })
          )
        )
        safe.forEach((tc, i) => resultsById.set(tc.id, settled[i]))
      }
      for (const tc of risky) {
        if (signal.aborted) break
        if (!isSubagentToolAllowed(tc.name, mode)) {
          resultsById.set(tc.id, {
            toolCallId: tc.id,
            content: `Blocked in subagent ${mode} mode: ${tc.name}`,
            isError: true
          })
          continue
        }
        resultsById.set(
          tc.id,
          await executeTool(tc, toolCwd, signal, {
            sessionId: opts.sessionId,
            subagent: true
          })
        )
      }

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
          content: String(raw.content || '').slice(0, 24_000),
          isError: raw.isError === true
        })
      }
      useSubagentRunsStore.getState().tick(runId, { rounds, toolsUsed: [...toolsUsed] })
    }

    const lastAssistant = [...entries].reverse().find((e) => e.role === 'assistant')
    let summary =
      (lastAssistant && 'content' in lastAssistant ? String(lastAssistant.content || '') : '') ||
      `Hit max rounds (${maxRounds}) without a final answer.`
    if (worktreePath && window.api?.worktree?.diffStat) {
      const diff = await window.api.worktree.diffStat(worktreePath)
      if (diff) summary += `\n\n### Worktree diff\n${diff}`
    }
    return finish({
      name,
      ok: true,
      summary: summary.slice(0, 12_000),
      rounds,
      toolsUsed,
      error: `max_rounds=${maxRounds}`,
      isolation,
      worktreePath
    })
  } finally {
    nestingDepth--
    if (worktreePath && opts.projectPath && window.api?.worktree?.remove) {
      // Keep worktree for inspection if worker succeeded with changes? Always prune to avoid clutter.
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
  }
): Promise<SubagentResult[]> {
  const capped = tasks.slice(0, MAX_PARALLEL_SUBAGENTS)
  return Promise.all(capped.map((t) => runSubagent(t, opts)))
}

export function formatSubagentResults(results: SubagentResult[]): string {
  const lines: string[] = [`# Subagent results (${results.length})`, '']
  for (const r of results) {
    lines.push(
      `## ${r.name} — ${r.ok ? 'ok' : 'FAIL'} (rounds=${r.rounds}${r.isolation ? `, ${r.isolation}` : ''})`
    )
    if (r.worktreePath) lines.push(`worktree: ${r.worktreePath}`)
    if (r.toolsUsed.length) {
      lines.push(`tools: ${[...new Set(r.toolsUsed)].join(', ')}`)
    }
    if (r.error) lines.push(`note: ${r.error}`)
    lines.push('')
    lines.push(r.summary || '(empty)')
    lines.push('')
  }
  return lines.join('\n').slice(0, 40_000)
}
