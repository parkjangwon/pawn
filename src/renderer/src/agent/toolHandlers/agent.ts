import { readSkill } from '../skills'
import { installSkillFromRepo } from '../skillInstaller'
import { resolveToolPath } from '../pathUtils'
import { usePlanStore } from '../../stores/plan'
import { runProjectChecks } from '../runChecks'
import { searchCodebase } from '../codebaseSearch'
import { listArtifacts, writeArtifact } from '../artifacts'
import { buildRepoMap } from '../repoMap'
import { buildIssuePrPlaybook, parseIssuePrArg } from '../issueWorkflow'
import {
  formatSubagentResults,
  runParallelSubagents,
  runSubagent,
  type SubagentIsolation,
  type SubagentMode,
  type SubagentTask
} from '../subagent'
import type { ToolHandler } from './types'


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
        if (!projectPath) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const name = String(call.arguments.name || '')
        const content = String(call.arguments.content ?? '')
        const res = await writeArtifact(projectPath, name, content)
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'write failed', isError: true }
        return { toolCallId: call.id, content: `Wrote artifact: ${res.path}` }
      }


const list_artifacts: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!projectPath) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const sub = call.arguments.subdir ? String(call.arguments.subdir) : ''
        return { toolCallId: call.id, content: await listArtifacts(projectPath, sub) }
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
  const playbook = buildIssuePrPlaybook(parsed)
  return {
    toolCallId: call.id,
    content:
      playbook +
      `\n\nProject cwd: ${projectPath || '(none)'}\n` +
      `Begin step 1 now with the appropriate tools.`
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
  const modeRaw = String(call.arguments.mode || 'explore')
  const mode: SubagentMode = modeRaw === 'worker' ? 'worker' : 'explore'
  const isoRaw = String(call.arguments.isolation || '')
  const isolation: SubagentIsolation | undefined =
    isoRaw === 'worktree' || isoRaw === 'none' ? isoRaw : undefined
  const result = await runSubagent(
    {
      prompt,
      name: call.arguments.name ? String(call.arguments.name) : undefined,
      mode,
      isolation,
      maxRounds:
        call.arguments.max_rounds !== undefined ? Number(call.arguments.max_rounds) : undefined
    },
    {
      projectId: ctx?.projectId || '__general__',
      sessionId: ctx?.sessionId || 'subagent',
      projectPath,
      signal
    }
  )
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
    const modeRaw = String(row.mode || 'explore')
    const isoRaw = String(row.isolation || '')
    return {
      prompt: String(row.prompt || ''),
      name: row.name ? String(row.name) : `task-${i + 1}`,
      mode: (modeRaw === 'worker' ? 'worker' : 'explore') as SubagentMode,
      isolation:
        isoRaw === 'worktree' || isoRaw === 'none'
          ? (isoRaw as SubagentIsolation)
          : undefined,
      maxRounds: row.max_rounds !== undefined ? Number(row.max_rounds) : undefined
    }
  })
  if (tasks.some((t) => !t.prompt.trim())) {
    return { toolCallId: call.id, content: 'Each task needs a non-empty prompt', isError: true }
  }
  const results = await runParallelSubagents(tasks, {
    projectId: ctx?.projectId || '__general__',
    sessionId: ctx?.sessionId || 'subagent',
    projectPath,
    signal
  })
  const anyFail = results.some((r) => !r.ok)
  return {
    toolCallId: call.id,
    content: formatSubagentResults(results),
    isError: anyFail
  }
}

export const agentHandlers: Record<string, ToolHandler> = {
  update_plan,
  run_checks,
  codebase_search,
  write_artifact,
  list_artifacts,
  load_skill,
  install_skill,
  repo_map,
  issue_to_pr,
  spawn_agent,
  parallel_agents
}
