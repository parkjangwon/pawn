/**
 * Handlers for model-native coding tools (see ../nativeTools.ts):
 * Claude's str_replace_based_edit_tool + bash, and apply_patch for GPT models.
 */

import { resolveToolPath } from '../pathUtils'
import { applyChunks, parsePatch, summarizeOps } from '../applyPatch'
import { checkStale, noteFileSeen, snapshotScope } from '../fileSnapshots'
import { commitFileWrites, relPath, type FileWrite } from '../fileTransaction'
import { APPLY_PATCH_NAME, BASH_NAME, TEXT_EDITOR_NAME } from '../nativeTools'
import { fsHandlers } from './fs'
import { shellHandlers, shellSandboxFor } from './shell'
import type { ToolExecContext, ToolHandler } from './types'

const VIEW_MAX_LINES = 2000
const VIEW_MAX_CHARS = 120_000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', 'target', '__pycache__', '.venv', 'venv'])

function numbered(lines: string[], from: number): string {
  return lines.map((l, i) => `${String(from + i).padStart(6)}\t${l}`).join('\n')
}

async function viewDirectory(dir: string, api: typeof window.api): Promise<string> {
  const out: string[] = []
  const walk = async (d: string, depth: number, prefix: string): Promise<void> => {
    if (out.length > 400) return
    const list = await api.fs.listDir(d)
    if (!Array.isArray(list)) return
    const sorted = [...list].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
    for (const e of sorted) {
      if (e.name.startsWith('.') || (e.isDirectory && SKIP_DIRS.has(e.name))) continue
      out.push(`${prefix}${e.name}${e.isDirectory ? '/' : ''}`)
      if (e.isDirectory && depth < 2) await walk(`${d.replace(/\/$/, '')}/${e.name}`, depth + 1, `${prefix}  `)
      if (out.length > 400) {
        out.push(`${prefix}…`)
        return
      }
    }
  }
  await walk(dir, 1, '')
  return `Files and directories up to 2 levels deep in ${dir}, excluding hidden items:\n${out.join('\n') || '(empty)'}`
}

function sessionShellKey(ctx?: ToolExecContext): string {
  if (ctx?.subagent && ctx.subagentRunId) return `sub-${ctx.subagentRunId}`.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120)
  return (ctx?.sessionId || 'default').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120)
}

const textEditor: ToolHandler = async (call, projectPath, signal, ctx, api) => {
  const a = call.arguments || {}
  const command = String(a.command || '')
  const rawPath = typeof a.path === 'string' ? a.path : ''
  if (!rawPath) return { toolCallId: call.id, content: 'Error: path is required', isError: true }
  // "src/." / "src/" → "src" (directory views)
  const path = resolveToolPath(rawPath, projectPath).replace(/\/\.?$/, '') || '/'
  const delegate = (name: string, args: Record<string, unknown>) =>
    fsHandlers[name]({ ...call, name, arguments: args }, projectPath, signal, ctx, api)

  switch (command) {
    case 'view': {
      const st = api.fs.stat ? await api.fs.stat(path).catch(() => null) : null
      if (st && 'isDirectory' in st && st.isDirectory) {
        return { toolCallId: call.id, content: await viewDirectory(path, api) }
      }
      const res = await api.fs.readFile(path)
      if (typeof res !== 'string') {
        return { toolCallId: call.id, content: `Error: ${res.error || `File not found: ${path}`}`, isError: true }
      }
      noteFileSeen(snapshotScope(ctx), path, res)
      const lines = res.split('\n')
      const range = Array.isArray(a.view_range) ? (a.view_range as unknown[]).map(Number) : null
      let start = 1
      let end = lines.length
      if (range && range.length === 2 && Number.isFinite(range[0])) {
        start = Math.max(1, Math.floor(range[0]))
        end = range[1] === -1 || !Number.isFinite(range[1]) ? lines.length : Math.min(lines.length, Math.floor(range[1]))
        if (start > lines.length) {
          return { toolCallId: call.id, content: `Error: view_range start ${start} is beyond the end of the file (${lines.length} lines)`, isError: true }
        }
        if (end < start) return { toolCallId: call.id, content: 'Error: view_range end must be >= start (or -1)', isError: true }
      }
      let slice = lines.slice(start - 1, end)
      let more = ''
      if (slice.length > VIEW_MAX_LINES) {
        slice = slice.slice(0, VIEW_MAX_LINES)
        more = `\n…[${end - start + 1 - VIEW_MAX_LINES} more lines — view with view_range [${start + VIEW_MAX_LINES}, -1]]`
      }
      let body = numbered(slice, start)
      if (body.length > VIEW_MAX_CHARS) {
        body = body.slice(0, VIEW_MAX_CHARS)
        more = `\n…[truncated by size — use a narrower view_range]`
      }
      return { toolCallId: call.id, content: body + more }
    }
    case 'create': {
      if (typeof a.file_text !== 'string') return { toolCallId: call.id, content: 'Error: file_text is required for create', isError: true }
      return delegate('write_file', { path: rawPath, content: a.file_text })
    }
    case 'str_replace': {
      if (typeof a.old_str !== 'string' || !a.old_str) return { toolCallId: call.id, content: 'Error: old_str is required for str_replace', isError: true }
      return delegate('edit_file', { path: rawPath, old_string: a.old_str, new_string: typeof a.new_str === 'string' ? a.new_str : '' })
    }
    case 'insert': {
      const text = typeof a.insert_text === 'string' ? a.insert_text : typeof a.new_str === 'string' ? a.new_str : null
      const at = Math.floor(Number(a.insert_line))
      if (text === null) return { toolCallId: call.id, content: 'Error: insert_text is required for insert', isError: true }
      const res = await api.fs.readFile(path)
      if (typeof res !== 'string') return { toolCallId: call.id, content: `Error: ${res.error || `File not found: ${path}`}`, isError: true }
      const lines = res.split('\n')
      if (!Number.isFinite(at) || at < 0 || at > lines.length) {
        return { toolCallId: call.id, content: `Error: insert_line must be between 0 and ${lines.length}`, isError: true }
      }
      // Line numbers came from the model's last view; a changed file means they may be wrong.
      if (checkStale(snapshotScope(ctx), path, res) === 'stale') {
        return {
          toolCallId: call.id,
          content: `Error: ${path} changed on disk since you last viewed it, so line ${at} may point elsewhere. View it again, then insert.`,
          isError: true
        }
      }
      const insert = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
      const next = [...lines.slice(0, at), ...insert, ...lines.slice(at)].join('\n')
      const r = await delegate('write_file', { path: rawPath, content: next })
      if (r.isError) return r
      const window = next.split('\n').slice(Math.max(0, at - 2), at + insert.length + 2)
      return { ...r, content: `Inserted ${insert.length} line${insert.length === 1 ? '' : 's'} after line ${at} of ${path}.\n${numbered(window, Math.max(1, at - 1))}${r.content.replace(/^File written: [^\n]*/, '')}` }
    }
    case 'undo_edit':
      return {
        toolCallId: call.id,
        content: 'Error: undo_edit is not supported. Use str_replace to restore the previous text (the user can also undo the whole turn).',
        isError: true
      }
    default:
      return { toolCallId: call.id, content: `Error: unknown command "${command}". Use view, create, str_replace or insert.`, isError: true }
  }
}

const bash: ToolHandler = async (call, projectPath, signal, ctx, api) => {
  const a = call.arguments || {}
  const key = sessionShellKey(ctx)
  const cwd = projectPath || ''
  const sandbox = shellSandboxFor(a, projectPath, ctx)
  // Web preview / old desktop builds: one-shot shell instead of a session.
  if (!api.bash?.run || !cwd) {
    if (a.restart === true) return { toolCallId: call.id, content: 'Bash session restarted.' }
    return shellHandlers.shell_exec({ ...call, name: 'shell_exec', arguments: { command: a.command, timeout: 300 } }, projectPath, signal, ctx, api)
  }
  if (a.restart === true) {
    const r = await api.bash.restart(key, cwd, sandbox)
    return { toolCallId: call.id, content: r.ok ? r.text || 'Bash session restarted.' : `Error: ${r.error}`, isError: !r.ok }
  }
  const command = typeof a.command === 'string' ? a.command : ''
  if (!command.trim()) return { toolCallId: call.id, content: 'Error: command is required (or restart: true)', isError: true }
  if (signal?.aborted) return { toolCallId: call.id, content: 'Tool was not executed (run aborted).', isError: true }
  const run = api.bash.run(key, command, { cwd, timeoutMs: 300_000, sandbox })
  const onAbort = (): void => {
    void api.bash?.kill(key).catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await run
    if (!r.ok) return { toolCallId: call.id, content: `Error: ${r.error}`, isError: true }
    const failed = r.timedOut === true || (typeof r.exitCode === 'number' && r.exitCode !== 0)
    return { toolCallId: call.id, content: r.text || '(no output)', isError: failed }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

const applyPatch: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const text = String(call.arguments?.input ?? call.arguments?.patch ?? '')
  if (!text.trim()) return { toolCallId: call.id, content: 'Error: input (the patch text) is required', isError: true }
  const parsed = parsePatch(text)
  if (!parsed.ok) return { toolCallId: call.id, content: `Invalid patch: ${parsed.error}`, isError: true }
  const scope = snapshotScope(ctx)
  const writes: FileWrite[] = []
  const summary: string[] = []
  const staleNotes: string[] = []
  const exists = async (p: string): Promise<string | null> => {
    const r = await api.fs.readFile(p)
    return typeof r === 'string' ? r : null
  }
  // Validate and compute every file first; nothing touches disk until all apply.
  for (const op of parsed.ops) {
    const abs = resolveToolPath(op.path, projectPath)
    const rel = relPath(abs, projectPath)
    if (op.type === 'add') {
      if ((await exists(abs)) !== null) {
        return { toolCallId: call.id, content: `Error: ${rel} already exists — use "*** Update File:" to change it.`, isError: true }
      }
      writes.push({ path: abs, before: null, after: op.content })
      summary.push(`A ${rel}`)
      continue
    }
    const current = await exists(abs)
    if (current === null) {
      return { toolCallId: call.id, content: `Error: ${rel} does not exist${op.type === 'update' ? ' — use "*** Add File:" to create it' : ''}.`, isError: true }
    }
    if (op.type === 'delete') {
      writes.push({ path: abs, before: current, after: null })
      summary.push(`D ${rel}`)
      continue
    }
    if (checkStale(scope, abs, current) === 'stale') staleNotes.push(rel)
    const applied = applyChunks(current, op.chunks, rel)
    if (!applied.ok) return { toolCallId: call.id, content: `Error applying patch: ${applied.error}`, isError: true }
    if (op.moveTo) {
      const dest = resolveToolPath(op.moveTo, projectPath)
      if ((await exists(dest)) !== null) {
        return { toolCallId: call.id, content: `Error: cannot move ${rel} to ${relPath(dest, projectPath)}: destination exists.`, isError: true }
      }
      writes.push({ path: dest, before: null, after: applied.content })
      writes.push({ path: abs, before: current, after: null })
      summary.push(`M ${rel} -> ${relPath(dest, projectPath)}`)
    } else {
      writes.push({ path: abs, before: current, after: applied.content })
      summary.push(`M ${rel}`)
    }
  }
  const res = await commitFileWrites(writes, { projectPath, ctx, toolCallId: call.id, api })
  if (!res.ok) return { toolCallId: call.id, content: `Error: ${res.error}`, isError: true }
  const stale = staleNotes.length
    ? `\nNote: ${staleNotes.join(', ')} changed on disk since you last read ${staleNotes.length > 1 ? 'them' : 'it'}; the patch matched the current content. Re-read before further edits.`
    : ''
  return {
    toolCallId: call.id,
    content: `Success. Updated the following files:\n${summary.join('\n')}${res.notes}${stale}`,
    diffData: res.diffData
  }
}

export const nativeHandlers: Record<string, ToolHandler> = {
  [TEXT_EDITOR_NAME]: textEditor,
  [BASH_NAME]: bash,
  [APPLY_PATCH_NAME]: applyPatch
}

export { summarizeOps }
