import { resolveToolPath } from '../pathUtils'
import { useProviderStore } from '../../stores/provider'
import type { ToolExecContext, ToolHandler } from './types'
import { applyTextEdits, commitFileWrites, type FileWrite } from '../fileTransaction'

/** File types a language server can check (keep in sync with main/lsp/servers.ts). */
const LSP_EXTENSIONS = /\.(tsx?|mts|cts|jsx?|mjs|cjs|py|pyi|go|rs)$/i

export function lspSupports(path: string): boolean {
  return LSP_EXTENSIONS.test(path)
}

const MAX_LISTED = 12

function rel(path: string, root?: string): string {
  if (root && path.startsWith(root.endsWith('/') ? root : root + '/')) return path.slice(root.length + 1)
  return path
}

export function formatDiagnostics(
  files: Array<{ path: string; diagnostics: LspDiagnosticDto[] }>,
  opts: { root?: string; includeWarnings?: boolean }
): string {
  const lines: string[] = []
  let errors = 0
  let warnings = 0
  for (const f of files) {
    for (const d of f.diagnostics) {
      if (d.severity === 'error') errors++
      else if (d.severity === 'warning') warnings++
      else continue
      if (d.severity === 'warning' && !opts.includeWarnings) continue
      if (lines.length >= MAX_LISTED) continue
      const code = d.code !== undefined ? ` ${d.source === 'typescript' || d.source === 'ts' ? 'TS' : ''}${d.code}` : ''
      lines.push(`${rel(f.path, opts.root)}:${d.line}:${d.column} ${d.severity}${code}: ${d.message.split('\n')[0].slice(0, 300)}`)
    }
  }
  const shown = lines.length
  const hidden = errors + (opts.includeWarnings ? warnings : 0) - shown
  const head =
    errors === 0 && (warnings === 0 || !opts.includeWarnings)
      ? `no errors${warnings ? ` (${warnings} warning${warnings > 1 ? 's' : ''})` : ''}`
      : `${errors} error${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}`
  return [head, ...lines, ...(hidden > 0 ? [`…${hidden} more`] : [])].join('\n')
}

/**
 * Bounded post-edit check used by write_file / edit_file: returns a short
 * note, or '' when LSP is off, unsupported, still warming up, or slow.
 */
export async function postEditDiagnostics(path: string, content: string, projectPath?: string): Promise<string> {
  const api = window.api?.lsp
  if (!api?.diagnostics || !projectPath || !lspSupports(path)) return ''
  if (!useProviderStore.getState().lspDiagnostics) return ''
  try {
    const res = await Promise.race([
      api.diagnostics(projectPath, [path], { waitMs: 2500, content: { [path]: content } }),
      new Promise<null>((r) => setTimeout(() => r(null), 6000))
    ])
    if (!res || !res.files?.length) return ''
    const file = res.files[0] as { path: string; diagnostics: LspDiagnosticDto[]; fresh?: boolean }
    if (file.fresh === false) return ''
    return `\n[lsp] ${formatDiagnostics([file], { root: projectPath })}`
  } catch {
    return ''
  }
}

function lspUnavailable(callId: string, message?: string) {
  return {
    toolCallId: callId,
    content:
      message ||
      'Language servers are unavailable here. Use run_checks (typecheck) or grep_search / codebase_search instead.',
    isError: true
  }
}

const lsp_diagnostics: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  if (!api.lsp?.diagnostics || !projectPath) return lspUnavailable(call.id)
  const raw = Array.isArray(call.arguments.paths) ? call.arguments.paths : [call.arguments.paths]
  const paths = raw.filter((p): p is string => typeof p === 'string' && !!p).slice(0, 20).map((p) => resolveToolPath(p, projectPath))
  if (!paths.length) return { toolCallId: call.id, content: 'paths is required', isError: true }
  const res = await api.lsp.diagnostics(projectPath, paths, { waitMs: 4000 })
  if (!res.files?.length) {
    return lspUnavailable(
      call.id,
      res.error
        ? `Language server unavailable: ${res.error}\nFall back to run_checks (typecheck).`
        : res.unsupported?.length
          ? `No language server for: ${res.unsupported.join(', ')}. Use run_checks instead.`
          : undefined
    )
  }
  const body = formatDiagnostics(res.files, { root: projectPath, includeWarnings: call.arguments.include_warnings === true })
  const note = res.unsupported?.length ? `\n(unsupported, not checked: ${res.unsupported.map((p) => rel(p, projectPath)).join(', ')})` : ''
  return { toolCallId: call.id, content: body + note }
}

function positionArgs(call: { arguments: Record<string, unknown> }): { line: number; column: number } | null {
  const line = Math.floor(Number(call.arguments.line))
  const column = Math.floor(Number(call.arguments.column ?? call.arguments.character ?? 1))
  if (!Number.isFinite(line) || line < 1 || !Number.isFinite(column) || column < 1) return null
  return { line, column }
}

function locationHandler(kind: 'definition' | 'references'): ToolHandler {
  return async (call, projectPath, _signal, _ctx, api) => {
    const fn = api.lsp?.[kind]
    if (!fn || !projectPath) return lspUnavailable(call.id)
    const pos = positionArgs(call)
    const file = typeof call.arguments.path === 'string' ? resolveToolPath(call.arguments.path, projectPath) : ''
    if (!pos || !file) return { toolCallId: call.id, content: 'path, line and column (1-based) are required', isError: true }
    const res = await fn(projectPath, file, pos.line, pos.column)
    if (!res.ok && res.error) return lspUnavailable(call.id, `Language server: ${res.error}`)
    const locs = res.locations || []
    if (!locs.length) {
      return {
        toolCallId: call.id,
        content: `No ${kind} found at ${rel(file, projectPath)}:${pos.line}:${pos.column}. Check the position points at a symbol.`
      }
    }
    const shown = locs.slice(0, 60)
    const lines = shown.map((l) => `${rel(l.path, projectPath)}:${l.line}:${l.column}${l.preview ? `  ${l.preview}` : ''}`)
    const more = locs.length > shown.length ? `\n…${locs.length - shown.length} more` : ''
    return {
      toolCallId: call.id,
      content: `${locs.length} ${kind === 'definition' ? 'definition' : 'reference'}${locs.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more}`
    }
  }
}

function fileArg(call: { arguments: Record<string, unknown> }, projectPath: string): string {
  return typeof call.arguments.path === 'string' ? resolveToolPath(call.arguments.path, projectPath) : ''
}

const lsp_hover: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  if (!api.lsp?.hover || !projectPath) return lspUnavailable(call.id)
  const pos = positionArgs(call)
  const file = fileArg(call, projectPath)
  if (!pos || !file) return { toolCallId: call.id, content: 'path, line and column (1-based) are required', isError: true }
  const res = await api.lsp.hover(projectPath, file, pos.line, pos.column)
  if (!res.ok && res.error) return lspUnavailable(call.id, `Language server: ${res.error}`)
  return { toolCallId: call.id, content: res.text?.trim() || `No hover information at ${rel(file, projectPath)}:${pos.line}:${pos.column}.` }
}

const lsp_symbols: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  if (!api.lsp?.symbols || !projectPath) return lspUnavailable(call.id)
  const file = fileArg(call, projectPath)
  if (!file) return { toolCallId: call.id, content: 'path is required', isError: true }
  const query = typeof call.arguments.query === 'string' ? call.arguments.query.trim() : ''
  const res = await api.lsp.symbols(projectPath, file, query)
  if (!res.ok && res.error) return lspUnavailable(call.id, `Language server: ${res.error}`)
  const syms = res.symbols || []
  if (!syms.length) return { toolCallId: call.id, content: query ? `No workspace symbols match "${query}".` : `No symbols in ${rel(file, projectPath)}.` }
  const lines = syms.slice(0, 250).map((sy) =>
    query
      ? `${sy.kind} ${sy.name}${sy.container ? ` (${sy.container})` : ''} — ${rel(sy.path, projectPath)}:${sy.line}`
      : `${'  '.repeat(sy.depth || 0)}${sy.kind} ${sy.name}${sy.detail ? ` ${sy.detail}` : ''} :${sy.line}${sy.endLine && sy.endLine !== sy.line ? `-${sy.endLine}` : ''}`
  )
  return {
    toolCallId: call.id,
    content: `${query ? `Workspace symbols for "${query}"` : `Outline of ${rel(file, projectPath)}`} (${syms.length}):\n${lines.join('\n')}${syms.length > 250 ? '\n…' : ''}`
  }
}

const lsp_call_hierarchy: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  if (!api.lsp?.callHierarchy || !projectPath) return lspUnavailable(call.id)
  const pos = positionArgs(call)
  const file = fileArg(call, projectPath)
  if (!pos || !file) return { toolCallId: call.id, content: 'path, line and column (1-based) are required', isError: true }
  const direction = call.arguments.direction === 'outgoing' ? 'outgoing' : 'incoming'
  const res = await api.lsp.callHierarchy(projectPath, file, pos.line, pos.column, direction)
  if (!res.ok && res.error) return lspUnavailable(call.id, `Language server: ${res.error}`)
  const calls = res.calls || []
  const head = res.item ? `${res.item.kind} ${res.item.name} (${rel(res.item.path, projectPath)}:${res.item.line})` : 'symbol'
  if (!calls.length) return { toolCallId: call.id, content: `${head}: no ${direction} calls found.` }
  const lines = calls.map(
    (c) => `- ${c.kind} ${c.name} — ${rel(c.path, projectPath)}:${c.line}${c.callLines.length ? ` (call at line${c.callLines.length > 1 ? 's' : ''} ${c.callLines.join(', ')})` : ''}`
  )
  return { toolCallId: call.id, content: `${direction === 'incoming' ? 'Callers of' : 'Calls made by'} ${head}:\n${lines.join('\n')}` }
}

/** Apply a language-server WorkspaceEdit through the change ledger. */
export async function applyWorkspaceEdit(
  edit: LspWorkspaceEditDto,
  opts: { projectPath: string; ctx?: ToolExecContext; toolCallId: string; api: typeof window.api }
): Promise<{ ok: boolean; error?: string; summary: string[]; notes: string; diffData?: { oldText: string; newText: string; filename: string; path?: string } }> {
  const { api } = opts
  const read = async (p: string): Promise<string | null> => {
    const r = await api.fs.readFile(p).catch(() => null)
    return typeof r === 'string' ? r : null
  }
  const writes: FileWrite[] = []
  const summary: string[] = []
  for (const c of edit.creates) {
    if ((await read(c)) === null) {
      writes.push({ path: c, before: null, after: '' })
      summary.push(`A ${rel(c, opts.projectPath)}`)
    }
  }
  for (const f of edit.files) {
    const current = writes.find((w) => w.path === f.path)?.after ?? (await read(f.path))
    if (current === null) return { ok: false, error: `${rel(f.path, opts.projectPath)} does not exist`, summary: [], notes: '' }
    const applied = applyTextEdits(current, f.edits)
    if (!applied.ok) return { ok: false, error: `${rel(f.path, opts.projectPath)}: ${applied.error}`, summary: [], notes: '' }
    const existing = writes.find((w) => w.path === f.path)
    if (existing) existing.after = applied.text
    else writes.push({ path: f.path, before: current, after: applied.text })
    summary.push(`M ${rel(f.path, opts.projectPath)} (${f.edits.length} edit${f.edits.length === 1 ? '' : 's'})`)
  }
  for (const r of edit.renames) {
    const content = writes.find((w) => w.path === r.from)?.after ?? (await read(r.from))
    if (content === null) return { ok: false, error: `${rel(r.from, opts.projectPath)} does not exist`, summary: [], notes: '' }
    const idx = writes.findIndex((w) => w.path === r.from)
    const before = idx >= 0 ? writes[idx].before : content
    if (idx >= 0) writes.splice(idx, 1)
    writes.push({ path: r.to, before: null, after: content })
    writes.push({ path: r.from, before, after: null })
    summary.push(`R ${rel(r.from, opts.projectPath)} -> ${rel(r.to, opts.projectPath)}`)
  }
  for (const d of edit.deletes) {
    const cur = await read(d)
    if (cur !== null) {
      writes.push({ path: d, before: cur, after: null })
      summary.push(`D ${rel(d, opts.projectPath)}`)
    }
  }
  if (!writes.length) return { ok: true, summary: [], notes: '' }
  const res = await commitFileWrites(writes, { projectPath: opts.projectPath, ctx: opts.ctx, toolCallId: opts.toolCallId, api })
  if (!res.ok) return { ok: false, error: res.error, summary: [], notes: '' }
  return { ok: true, summary, notes: res.notes, diffData: res.diffData }
}

const lsp_rename: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  if (!api.lsp?.rename || !projectPath) return lspUnavailable(call.id)
  const pos = positionArgs(call)
  const file = fileArg(call, projectPath)
  const newName = typeof call.arguments.new_name === 'string' ? call.arguments.new_name.trim() : ''
  if (!pos || !file || !newName) return { toolCallId: call.id, content: 'path, line, column and new_name are required', isError: true }
  const res = await api.lsp.rename(projectPath, file, pos.line, pos.column, newName)
  if (!res.ok || !res.edit) return { toolCallId: call.id, content: `Rename failed: ${res.error || 'no edits returned'}`, isError: true }
  const applied = await applyWorkspaceEdit(res.edit, { projectPath, ctx, toolCallId: call.id, api })
  if (!applied.ok) return { toolCallId: call.id, content: `Rename failed: ${applied.error}`, isError: true }
  if (!applied.summary.length) return { toolCallId: call.id, content: 'The language server returned no changes for this rename.' }
  return {
    toolCallId: call.id,
    content: `Renamed to ${newName}:\n${applied.summary.join('\n')}${applied.notes}`,
    diffData: applied.diffData
  }
}

const lsp_code_actions: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  if (!api.lsp?.codeActions || !projectPath) return lspUnavailable(call.id)
  const file = fileArg(call, projectPath)
  const line = Math.floor(Number(call.arguments.line))
  const endLine = Math.floor(Number(call.arguments.end_line ?? call.arguments.line))
  if (!file || !(line >= 1)) return { toolCallId: call.id, content: 'path and line (1-based) are required', isError: true }
  const only = Array.isArray(call.arguments.only) ? call.arguments.only.map(String) : undefined
  const col = Math.floor(Number(call.arguments.column))
  const endCol = Math.floor(Number(call.arguments.end_column))
  // Exact selection when columns are given (extract refactorings), else whole lines.
  const range =
    col >= 1 && endCol >= 1
      ? { startLine: line, startColumn: col, endLine: Math.max(line, endLine), endColumn: endCol }
      : { startLine: line, startColumn: 1, endLine: Math.max(line, endLine) + 1, endColumn: 1 }
  const res = await api.lsp.codeActions(projectPath, file, range, only)
  if (!res.ok && res.error) return lspUnavailable(call.id, `Language server: ${res.error}`)
  const actions = res.actions || []
  if (!actions.length) return { toolCallId: call.id, content: `No code actions for ${rel(file, projectPath)}:${line}${endLine > line ? `-${endLine}` : ''}.` }
  const lines = actions.map(
    (a) => `[${a.index}] ${a.title}${a.kind ? ` (${a.kind})` : ''}${a.isPreferred ? ' ★' : ''}${a.disabled ? ` — disabled: ${a.disabled}` : ''}`
  )
  return { toolCallId: call.id, content: `Code actions for ${rel(file, projectPath)}:${line}:\n${lines.join('\n')}\nApply one with lsp_apply_code_action {"path", "index"}.` }
}

const lsp_apply_code_action: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  if (!api.lsp?.applyCodeAction || !projectPath) return lspUnavailable(call.id)
  const file = fileArg(call, projectPath)
  const index = Math.floor(Number(call.arguments.index))
  if (!file || !(index >= 0)) return { toolCallId: call.id, content: 'path and index are required', isError: true }
  const res = await api.lsp.applyCodeAction(projectPath, file, index)
  if (!res.ok || !res.edit) return { toolCallId: call.id, content: `Code action failed: ${res.error || 'no edit'}`, isError: true }
  const applied = await applyWorkspaceEdit(res.edit, { projectPath, ctx, toolCallId: call.id, api })
  if (!applied.ok) return { toolCallId: call.id, content: `Code action failed: ${applied.error}`, isError: true }
  return {
    toolCallId: call.id,
    content: applied.summary.length ? `Applied "${res.title}":\n${applied.summary.join('\n')}${applied.notes}` : `"${res.title}" made no file changes.`,
    diffData: applied.diffData
  }
}

export const lspHandlers: Record<string, ToolHandler> = {
  lsp_diagnostics,
  lsp_definition: locationHandler('definition'),
  lsp_references: locationHandler('references'),
  lsp_hover,
  lsp_symbols,
  lsp_call_hierarchy,
  lsp_rename,
  lsp_code_actions,
  lsp_apply_code_action
}
