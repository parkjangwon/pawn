/**
 * Handlers: runtime perception (shell_wait, browser_console / browser_network,
 * page-event reports after browser actions), context endurance (read_output,
 * working_notes), checkpoints, the repo profile, semantic search and
 * affected-test selection.
 */

import { resolveToolPath } from '../pathUtils'
import { execFileFor } from '../executionTarget'
import { useChangeLedger } from '../../stores/changeLedger'
import { analyzeProcessOutput, formatAnalysis, markJobSeen, noteBrowserSeq } from '../runtimeWatch'
import { findCheckpoint, listCheckpoints, markCheckpoint, planRestore } from '../checkpoints'
import { commitFileWrites, relPath } from '../fileTransaction'
import {
  addProfileNote,
  COMMAND_KINDS,
  detectProfile,
  formatProfileFull,
  loadProfile,
  updateProfile,
  type CommandKind
} from '../repoProfile'
import { getNotes, setNotes, NOTES_MAX_CHARS } from '../workingNotes'
import { browserOwnerKey } from './browserHelpers'
import type { ToolExecContext, ToolHandler } from './types'
import type { ToolResult } from '../toolDefinitionsTypes'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function sessionKeyOf(ctx?: ToolExecContext): string {
  if (ctx?.subagent && ctx.subagentRunId) return `sub-${ctx.subagentRunId}`
  return ctx?.sessionId || 'default'
}

// --- shell_wait ------------------------------------------------------------

const shell_wait: ToolHandler = async (call, _projectPath, signal, ctx, api) => {
  const jobId = String(call.arguments.job_id || call.arguments.jobId || '')
  if (!jobId) return { toolCallId: call.id, content: 'job_id is required', isError: true }
  const timeoutS = Math.min(600, Math.max(1, Number(call.arguments.timeout) || 60))
  let until: RegExp | null = null
  if (typeof call.arguments.until === 'string' && call.arguments.until) {
    try {
      until = new RegExp(call.arguments.until, 'i')
    } catch {
      until = new RegExp(call.arguments.until.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
  }
  const port = Number(call.arguments.port) || 0
  const deadline = Date.now() + timeoutS * 1000
  let reason = 'timeout'
  let last: Awaited<ReturnType<typeof api.shell.poll>> | null = null
  let matched = ''
  for (;;) {
    if (signal?.aborted) {
      reason = 'aborted'
      break
    }
    last = await api.shell.poll(jobId)
    if (last.error) return { toolCallId: call.id, content: last.error, isError: true }
    const all = `${last.stdout || ''}\n${last.stderr || ''}`
    if (until) {
      const m = until.exec(all)
      if (m) {
        reason = 'matched'
        const lineStart = all.lastIndexOf('\n', m.index) + 1
        matched = all.slice(lineStart, all.indexOf('\n', m.index) === -1 ? undefined : all.indexOf('\n', m.index)).trim().slice(0, 300)
        break
      }
    }
    if (port && api.net?.probePort && (await api.net.probePort(port).catch(() => ({ open: false }))).open) {
      reason = `port ${port} open`
      break
    }
    if (last.status === 'exited') {
      reason = 'exited'
      break
    }
    if (Date.now() >= deadline) break
    await sleep(400)
  }
  const all = `${last?.stdout || ''}${last?.stderr ? `\n${last.stderr}` : ''}`
  markJobSeen(sessionKeyOf(ctx), jobId, all.length)
  const analysis = analyzeProcessOutput(all)
  const tail = all.length > 3000 ? `…${all.slice(-3000)}` : all
  const head = `[${last?.status || 'unknown'}] ${reason}${matched ? `: ${matched}` : ''}${last?.status === 'exited' ? ` (exit ${last.exitCode})` : ''} after ${Math.round((last?.elapsedMs || 0) / 1000)}s`
  const errors = analysis.errors.length ? `\nerror lines:\n${analysis.errors.slice(-8).map((e) => `  ${e}`).join('\n')}` : ''
  const failed = reason === 'timeout' || reason === 'aborted' || (last?.status === 'exited' && last.exitCode !== 0 && !until)
  return {
    toolCallId: call.id,
    content: `${head}\n${formatAnalysis(analysis)}${errors}\n--- output tail ---\n${tail || '(no output yet)'}`,
    isError: failed && reason !== 'exited' ? true : last?.status === 'exited' && last.exitCode !== 0
  }
}

// --- browser runtime --------------------------------------------------------

const lastSeen = new Map<string, number>()

function browserRuntimeHandler(kind: 'console' | 'network'): ToolHandler {
  return async (call, _projectPath, _signal, ctx, api) => {
    if (!api.browser?.runtime) return { toolCallId: call.id, content: 'Browser runtime events are only available in the desktop app.', isError: true }
    const owner = browserOwnerKey(ctx)
    const key = `${owner || 'ui'}:${kind}`
    const level = String(call.arguments.level || 'warn')
    const res = await api.browser.runtime(owner, {
      since: call.arguments.all === true ? 0 : lastSeen.get(key) || 0,
      kinds: kind === 'network' ? ['network'] : ['console', 'exception', 'crash', 'load'],
      minLevel: kind === 'network' ? 'warn' : level === 'all' ? 'debug' : level === 'error' ? 'error' : 'warn',
      limit: 80,
      clear: call.arguments.clear === true
    })
    if (!res.ok) return { toolCallId: call.id, content: res.error || 'No browser tab', isError: true }
    lastSeen.set(key, res.latestSeq)
    if (owner) noteBrowserSeq(owner, res.latestSeq)
    const text = res.events.length
      ? res.text || ''
      : kind === 'network'
        ? 'No failed requests since the last check.'
        : `No ${level === 'error' ? 'errors' : 'errors or warnings'} since the last check.`
    return { toolCallId: call.id, content: `${res.url ? `${res.url}\n` : ''}${text}` }
  }
}

/**
 * Wrap a browser action so its result reports what the page logged while it
 * ran (console errors, exceptions, failed requests) — cause and effect in
 * one observation.
 */
export function withPageEvents(handler: ToolHandler): ToolHandler {
  return async (call, projectPath, signal, ctx, api) => {
    const runtime = api.browser?.runtime
    const owner = browserOwnerKey(ctx)
    let before = 0
    if (runtime) {
      const r = await runtime(owner, { since: Number.MAX_SAFE_INTEGER, limit: 1 }).catch(() => null)
      before = r?.latestSeq ?? 0
    }
    const result = await handler(call, projectPath, signal, ctx, api)
    if (!runtime) return result
    await sleep(250) // let handlers of the action's own requests / errors land
    const after = await runtime(owner, { since: before, minLevel: 'warn', limit: 12 }).catch(() => null)
    if (!after?.ok) return result
    if (owner) noteBrowserSeq(owner, after.latestSeq)
    const serious = after.events.filter((e) => e.level === 'error' || e.kind === 'network' || e.kind === 'exception')
    if (!serious.length) return result
    const lines = serious.slice(-8).map((e) =>
      e.kind === 'network'
        ? `- ${e.method || 'GET'} ${e.url} → ${e.status ?? e.text}`
        : `- ${e.kind === 'console' ? 'console.error' : e.kind}: ${e.text.slice(0, 300)}${e.source ? ` (${e.source})` : ''}`
    )
    return { ...result, content: `${result.content}\n\n[page reported ${serious.length} problem${serious.length === 1 ? '' : 's'} during this action]\n${lines.join('\n')}` }
  }
}

// --- read_output / working_notes -------------------------------------------

const read_output: ToolHandler = async (call, _p, _s, _ctx, api) => {
  if (!api.outputs?.read) return { toolCallId: call.id, content: 'Output storage is unavailable here.', isError: true }
  const a = call.arguments
  const res = await api.outputs.read(String(a.id || ''), {
    offset: a.offset,
    limit: a.limit,
    grep: typeof a.grep === 'string' ? a.grep : undefined,
    context: a.context,
    tail: a.tail
  })
  return res.ok ? { toolCallId: call.id, content: res.text || '' } : { toolCallId: call.id, content: res.error || 'Unknown output', isError: true }
}

const working_notes: ToolHandler = async (call, _p, _s, ctx) => {
  const key = sessionKeyOf(ctx)
  const action = String(call.arguments.action || 'view')
  const content = typeof call.arguments.content === 'string' ? call.arguments.content : ''
  let notes = getNotes(key)
  if (action === 'set') notes = content.trim()
  else if (action === 'append') notes = notes ? `${notes}\n${content.trim()}` : content.trim()
  else if (action !== 'view') return { toolCallId: call.id, content: `Unknown action "${action}" (view | set | append)`, isError: true }
  if (notes.length > NOTES_MAX_CHARS) {
    return {
      toolCallId: call.id,
      content: `Notes would be ${notes.length} chars (max ${NOTES_MAX_CHARS}). Condense them and use action "set".`,
      isError: true
    }
  }
  if (action !== 'view') setNotes(key, notes)
  return { toolCallId: call.id, content: `<working_notes>\n${notes}\n</working_notes>\n(${action === 'view' ? 'current' : 'saved'} — ${notes.length} chars)` }
}

// --- checkpoints ---------------------------------------------------------------

async function readOrNull(api: typeof window.api, p: string): Promise<string | null> {
  const r = await api.fs.readFile(p).catch(() => null)
  return typeof r === 'string' ? r : null
}

const checkpoint_mark: ToolHandler = async (call, projectPath, _s, ctx, api) => {
  if (!ctx?.sessionId) return { toolCallId: call.id, content: 'Checkpoints need a chat session.', isError: true }
  const cp = await markCheckpoint(sessionKeyOf(ctx), String(call.arguments.label || ''), (p) => readOrNull(api, p))
  const files = Array.from(cp.files.keys()).map((p) => relPath(p, projectPath))
  return {
    toolCallId: call.id,
    content: `Checkpoint "${cp.label}" marked (${files.length} changed file${files.length === 1 ? '' : 's'} captured${files.length ? `: ${files.slice(0, 12).join(', ')}${files.length > 12 ? ', …' : ''}` : ''}).`
  }
}

const checkpoint_restore: ToolHandler = async (call, projectPath, _s, ctx, api) => {
  if (!ctx?.sessionId) return { toolCallId: call.id, content: 'Checkpoints need a chat session.', isError: true }
  const key = sessionKeyOf(ctx)
  if (call.arguments.list === true) {
    const list = listCheckpoints(key)
    return {
      toolCallId: call.id,
      content: list.length
        ? list.map((c) => `- ${c.label} (${new Date(c.at).toLocaleTimeString()}, ${c.files.size} files)`).join('\n')
        : 'No checkpoints yet. Use checkpoint_mark at a known-good state.'
    }
  }
  const cp = findCheckpoint(key, typeof call.arguments.label === 'string' && call.arguments.label ? call.arguments.label : undefined)
  if (!cp) return { toolCallId: call.id, content: 'No such checkpoint. List them with {"list": true}.', isError: true }
  const writes = await planRestore(key, cp, (p) => readOrNull(api, p))
  if (!writes.length) return { toolCallId: call.id, content: `Already at checkpoint "${cp.label}" — nothing to restore.` }
  const res = await commitFileWrites(writes, { projectPath, ctx, toolCallId: call.id, api, diagnostics: false })
  if (!res.ok) return { toolCallId: call.id, content: `Restore failed: ${res.error}`, isError: true }
  const lines = writes.map((w) => `${w.after === null ? 'D' : w.before === null ? 'A' : 'M'} ${relPath(w.path, projectPath)}`)
  return { toolCallId: call.id, content: `Restored checkpoint "${cp.label}":\n${lines.join('\n')}\nRe-read these files before editing them again.` }
}

// --- project profile -----------------------------------------------------------

const project_profile: ToolHandler = async (call, projectPath) => {
  if (!projectPath) return { toolCallId: call.id, content: 'Open a project folder first.', isError: true }
  const action = String(call.arguments.action || 'view')
  if (action === 'refresh') {
    const fresh = await detectProfile(projectPath)
    updateProfile(projectPath, (p) => {
      p.stack = fresh.stack
      p.packageManager = fresh.packageManager
      p.conventions = fresh.conventions
      for (const k of COMMAND_KINDS) {
        const cur = p.commands[k]
        if (fresh.commands[k] && (!cur || cur.source === 'detected')) p.commands[k] = fresh.commands[k]
      }
      p.detectedAt = Date.now()
    })
  }
  const profile = await loadProfile(projectPath)
  if (!profile) return { toolCallId: call.id, content: 'Repo profiles are unavailable here.', isError: true }
  if (action === 'set_command') {
    const kind = String(call.arguments.kind || '') as CommandKind
    const command = typeof call.arguments.command === 'string' ? call.arguments.command.trim() : ''
    if (!COMMAND_KINDS.includes(kind) || !command) {
      return { toolCallId: call.id, content: `kind (${COMMAND_KINDS.join(' | ')}) and command are required`, isError: true }
    }
    updateProfile(projectPath, (p) => {
      p.commands[kind] = { command, source: 'user' }
    })
  } else if (action === 'add_note') {
    const note = typeof call.arguments.note === 'string' ? call.arguments.note : ''
    if (!note.trim()) return { toolCallId: call.id, content: 'note is required', isError: true }
    if (!addProfileNote(projectPath, note)) return { toolCallId: call.id, content: 'That note is already recorded.' }
  } else if (action === 'remove_note') {
    const i = Math.floor(Number(call.arguments.index))
    if (!(i >= 0 && i < profile.notes.length)) return { toolCallId: call.id, content: `index must be 0..${profile.notes.length - 1}`, isError: true }
    updateProfile(projectPath, (p) => {
      p.notes.splice(i, 1)
    })
  } else if (action !== 'view' && action !== 'refresh') {
    return { toolCallId: call.id, content: `Unknown action "${action}"`, isError: true }
  }
  return { toolCallId: call.id, content: formatProfileFull(profile) }
}

// --- code intelligence ---------------------------------------------------------

const semantic_search: ToolHandler = async (call, projectPath, _s, _ctx, api) => {
  if (!projectPath) return { toolCallId: call.id, content: 'No project open.', isError: true }
  if (!api.codeIndex?.search) {
    return { toolCallId: call.id, content: 'Semantic search is only available in the desktop app. Use codebase_search / grep_search.', isError: true }
  }
  const raw = call.arguments.queries ?? call.arguments.query
  const queries = (Array.isArray(raw) ? raw : [raw]).filter((q): q is string => typeof q === 'string' && !!q.trim())
  if (!queries.length) return { toolCallId: call.id, content: 'queries is required', isError: true }
  const res = await api.codeIndex.search(projectPath, queries, {
    limit: Number(call.arguments.limit) || 10,
    ...(typeof call.arguments.path_prefix === 'string' && call.arguments.path_prefix ? { pathPrefix: call.arguments.path_prefix.replace(/^\.\//, '') } : {})
  })
  if (!res.ok) return { toolCallId: call.id, content: res.error || 'Search failed', isError: true }
  return { toolCallId: call.id, content: res.text || 'No matches.' }
}

async function changedFiles(projectPath: string, ctx: ToolExecContext | undefined, api: typeof window.api): Promise<string[]> {
  const files = new Set<string>()
  for (const t of useChangeLedger.getState().turns) {
    if (ctx?.sessionId && t.sessionId !== ctx.sessionId) continue
    for (const c of t.changes) if (c.status === 'applied' && c.path.startsWith(projectPath)) files.add(c.path)
  }
  if (files.size === 0 && api.shell) {
    const r = await execFileFor(ctx, api)('git', ['diff', '--name-only', 'HEAD'], projectPath, 15_000).catch(() => null)
    const out = r && typeof r === 'object' && 'stdout' in r ? String((r as { stdout?: string }).stdout || '') : ''
    for (const line of out.split('\n')) if (line.trim()) files.add(`${projectPath.replace(/\/$/, '')}/${line.trim()}`)
  }
  return Array.from(files)
}

const affected_tests: ToolHandler = async (call, projectPath, _s, ctx, api) => {
  if (!projectPath) return { toolCallId: call.id, content: 'No project open.', isError: true }
  if (!api.tests?.affected) return { toolCallId: call.id, content: 'Affected-test selection is only available in the desktop app.', isError: true }
  const given = Array.isArray(call.arguments.paths)
    ? call.arguments.paths.filter((p): p is string => typeof p === 'string' && !!p).map((p) => resolveToolPath(p, projectPath))
    : []
  const files = given.length ? given : await changedFiles(projectPath, ctx, api)
  if (!files.length) return { toolCallId: call.id, content: 'No changed files found (nothing edited this session and git diff is empty). Pass paths.' }
  const res = await api.tests.affected(projectPath, files)
  if (!res.ok) return { toolCallId: call.id, content: res.error || 'Failed', isError: true }
  return { toolCallId: call.id, content: `Changed: ${files.map((f) => relPath(f, projectPath)).slice(0, 20).join(', ')}\n${res.text || ''}` }
}

export const runtimeHandlers: Record<string, ToolHandler> = {
  shell_wait,
  browser_console: browserRuntimeHandler('console'),
  browser_network: browserRuntimeHandler('network'),
  read_output,
  working_notes,
  checkpoint_mark,
  checkpoint_restore,
  project_profile,
  semantic_search,
  affected_tests
}

export type { ToolResult }
