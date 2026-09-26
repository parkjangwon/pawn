import { resolveToolPath } from '../pathUtils'
import { useProviderStore } from '../../stores/provider'
import type { ToolHandler } from './types'

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

export const lspHandlers: Record<string, ToolHandler> = {
  lsp_diagnostics,
  lsp_definition: locationHandler('definition'),
  lsp_references: locationHandler('references')
}
