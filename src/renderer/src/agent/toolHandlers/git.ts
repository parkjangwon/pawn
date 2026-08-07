import { resolveToolPath } from '../pathUtils'
import { gitPrReady } from '../gitPrReady'
import {
  gitAdd,
  gitBranchOp,
  gitCommit,
  gitPush,
  gitStash
} from '../gitWrite'
import type { ToolHandler } from './types'

function workDirOf(
  call: { arguments: Record<string, unknown> },
  projectPath: string | undefined
): string | null {
  const cwd = resolveToolPath(
    (call.arguments.cwd as string) || projectPath || undefined,
    projectPath
  )
  const workDir = !cwd || cwd === '.' ? projectPath : cwd
  return workDir || null
}

const git_pr_ready: ToolHandler = async (call, projectPath, _signal, _ctx, _api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const base = call.arguments.base ? String(call.arguments.base) : undefined
  const text = await gitPrReady(workDir, base)
  return { toolCallId: call.id, content: text }
}

const git_log: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const limit = Math.min(50, Math.max(1, Number(call.arguments.limit) || 15))
  const result = await api.shell.execFile(
    'git',
    ['log', `-n${limit}`, '--oneline', '--decorate'],
    workDir,
    15_000
  )
  if (result.exitCode !== 0 && !result.stdout) {
    return {
      toolCallId: call.id,
      content: result.stderr || 'git log failed',
      isError: true
    }
  }
  return { toolCallId: call.id, content: result.stdout.trim() || '(no commits)' }
}

const git_status: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const [branch, status] = await Promise.all([
    api.shell.execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workDir, 15_000),
    api.shell.execFile('git', ['status', '--short', '--branch'], workDir, 15_000)
  ])
  if (status.exitCode !== 0 && branch.exitCode !== 0) {
    return {
      toolCallId: call.id,
      content: status.stderr || branch.stderr || 'Not a git repository',
      isError: true
    }
  }
  const lines = [
    branch.exitCode === 0 ? `branch: ${branch.stdout.trim()}` : null,
    status.stdout.trim() || '(clean working tree)'
  ].filter(Boolean)
  return { toolCallId: call.id, content: lines.join('\n') }
}

const git_diff: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const pathArg = call.arguments.path
    ? resolveToolPath(String(call.arguments.path), projectPath)
    : ''
  const stagedOnly = Boolean(call.arguments.staged)
  const argsBase = stagedOnly
    ? ['diff', '--cached', '--no-color']
    : ['diff', 'HEAD', '--no-color']
  const args = pathArg ? [...argsBase, '--', pathArg] : argsBase
  const result = await api.shell.execFile('git', args, workDir, 30_000)
  if (result.exitCode !== 0 && !result.stdout) {
    return {
      toolCallId: call.id,
      content: result.stderr || 'git diff failed',
      isError: true
    }
  }
  const text = result.stdout || '(no changes)'
  const cap = 40_000
  return {
    toolCallId: call.id,
    content:
      text.length > cap
        ? text.slice(0, cap) + `\n...(truncated ${text.length - cap} chars)`
        : text
  }
}

const git_add: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const all = Boolean(call.arguments.all)
  const paths = Array.isArray(call.arguments.paths)
    ? (call.arguments.paths as unknown[]).map(String)
    : []
  if (!all && paths.length === 0) {
    return {
      toolCallId: call.id,
      content: 'Provide paths[] or all:true',
      isError: true
    }
  }
  const res = await gitAdd(api.shell.execFile.bind(api.shell), workDir, all ? 'all' : paths)
  return { toolCallId: call.id, content: res.text, isError: !res.ok }
}

const git_commit: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const res = await gitCommit(api.shell.execFile.bind(api.shell), workDir, {
    message: String(call.arguments.message || ''),
    allowEmpty: Boolean(call.arguments.allow_empty),
    noVerify: Boolean(call.arguments.no_verify)
  })
  return { toolCallId: call.id, content: res.text, isError: !res.ok }
}

const git_push: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const res = await gitPush(api.shell.execFile.bind(api.shell), workDir, {
    remote: call.arguments.remote ? String(call.arguments.remote) : undefined,
    branch: call.arguments.branch ? String(call.arguments.branch) : undefined,
    setUpstream: call.arguments.set_upstream !== false,
    force: Boolean(call.arguments.force)
  })
  return { toolCallId: call.id, content: res.text, isError: !res.ok }
}

const git_branch: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const res = await gitBranchOp(api.shell.execFile.bind(api.shell), workDir, {
    name: call.arguments.name ? String(call.arguments.name) : undefined,
    create: Boolean(call.arguments.create),
    delete: Boolean(call.arguments.delete),
    list: Boolean(call.arguments.list) || !call.arguments.name
  })
  return { toolCallId: call.id, content: res.text, isError: !res.ok }
}

const git_stash: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const workDir = workDirOf(call, projectPath)
  if (!workDir) {
    return { toolCallId: call.id, content: 'No project path set', isError: true }
  }
  const actionRaw = String(call.arguments.action || 'push')
  const action = (['push', 'pop', 'list', 'drop'].includes(actionRaw)
    ? actionRaw
    : 'push') as 'push' | 'pop' | 'list' | 'drop'
  const res = await gitStash(api.shell.execFile.bind(api.shell), workDir, {
    action,
    message: call.arguments.message ? String(call.arguments.message) : undefined
  })
  return { toolCallId: call.id, content: res.text, isError: !res.ok }
}

export const gitHandlers: Record<string, ToolHandler> = {
  git_pr_ready,
  git_log,
  git_status,
  git_diff,
  git_add,
  git_commit,
  git_push,
  git_branch,
  git_stash
}
