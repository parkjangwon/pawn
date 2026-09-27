/**
 * Model-native coding tools — the schemas each model family was trained on.
 *
 *   Claude (Anthropic API):  text_editor_20250728 ("str_replace_based_edit_tool":
 *                            view / create / str_replace / insert) and
 *                            bash_20250124 ("bash": one persistent shell session)
 *   GPT / o-series / Codex:  apply_patch (V4A multi-file patches, as in Codex)
 *
 * Trained schemas edit more reliably than a custom tool and batch multi-file
 * changes into one call. Execution goes through Pawn's own handlers, so undo
 * (change ledger), stale-write protection, edit verification, LSP
 * diagnostics, permissions and Plan mode all still apply.
 */

import type { ToolCall, ToolDefinition } from './toolDefinitionsTypes'
import { claudeModelVersion, isOfficialAnthropic } from './computerToolset'

export const TEXT_EDITOR_NAME = 'str_replace_based_edit_tool'
export const BASH_NAME = 'bash'
export const APPLY_PATCH_NAME = 'apply_patch'

/** Pawn tools the native Claude tools replace (removed from the request). */
export const CLAUDE_EDITOR_DUPLICATES = ['read_file', 'write_file', 'edit_file']

export const APPLY_PATCH_TOOL: ToolDefinition = {
  name: APPLY_PATCH_NAME,
  description:
    'Edit files by applying a patch in the apply_patch format (the same format as Codex). One call can add, update, move and delete several files. ' +
    'Format:\n*** Begin Patch\n*** Add File: path/new.ts\n+line\n*** Update File: path/old.ts\n*** Move to: path/renamed.ts (optional)\n@@ optional context line such as a function signature\n context line (starts with a space)\n-removed line\n+added line\n*** Delete File: path/gone.ts\n*** End Patch\n' +
    'Include ~3 lines of unchanged context around each change; use @@ lines to disambiguate repeated code. Paths are relative to the project root. ' +
    'Re-read a file if a hunk fails to match.',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The entire patch, from *** Begin Patch to *** End Patch.' }
    },
    required: ['input']
  }
}

export interface ClaudeNativePlan {
  entries: Array<Record<string, unknown>>
  /** Pawn tool names to remove from the request. */
  drop: Set<string>
  /** Short note for the project preamble (tool names changed). */
  note: string
}

/** Claude 4+ on the official API gets the trained editor / bash tools. */
export function planClaudeNativeTools(opts: {
  apiFormat: string
  baseUrl: string | undefined
  modelId: string
  toolNames: string[]
  platform?: string
  enabled?: boolean
}): ClaudeNativePlan | null {
  if (opts.enabled === false) return null
  if (opts.apiFormat !== 'claude' || !isOfficialAnthropic(opts.baseUrl)) return null
  const v = claudeModelVersion(opts.modelId)
  if (!v || v.version < 4) return null
  const names = new Set(opts.toolNames)
  const entries: Array<Record<string, unknown>> = []
  const drop = new Set<string>()
  const notes: string[] = []
  if (names.has('edit_file') && names.has('write_file')) {
    entries.push({ type: 'text_editor_20250728', name: TEXT_EDITOR_NAME })
    for (const n of CLAUDE_EDITOR_DUPLICATES) drop.add(n)
    notes.push(
      `${TEXT_EDITOR_NAME} replaces read_file / write_file / edit_file here (view with view_range, create, str_replace, insert).`
    )
  }
  // A persistent POSIX shell; Windows keeps shell_exec only.
  if (names.has('shell_exec') && opts.platform !== 'win32') {
    entries.push({ type: 'bash_20250124', name: BASH_NAME })
    notes.push(
      'bash is one persistent shell session (cwd, env and functions persist; interactive programs are not supported). ' +
        'Use shell_exec with background:true (plus shell_wait / shell_poll) only for long-running servers and watchers.'
    )
  }
  if (!entries.length) return null
  return { entries, drop, note: `--- Native tools on this connection ---\n${notes.join('\n')}` }
}

/** GPT-4.1+, GPT-5.x, o3/o4 and Codex models were trained on apply_patch. */
export function prefersApplyPatch(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  return /(^|\/)(gpt-4\.1|gpt-5|o3|o4|codex)/.test(id)
}

/** OpenAI-format request: add apply_patch and drop edit_file / write_file. */
export function planApplyPatch(modelId: string, toolNames: string[], enabled = true): { add: ToolDefinition; drop: Set<string> } | null {
  if (!enabled || !prefersApplyPatch(modelId)) return null
  if (!toolNames.includes('edit_file') || !toolNames.includes('write_file')) return null
  return { add: APPLY_PATCH_TOOL, drop: new Set(['edit_file', 'write_file']) }
}

/**
 * The name used for permissions, Plan mode, safety (parallel vs serial) and
 * the permission dialog — native tools map onto the Pawn tool they act as.
 */
export function nativeCodingPermissionName(call: Pick<ToolCall, 'name' | 'arguments'>): string | null {
  if (call.name === TEXT_EDITOR_NAME) {
    const cmd = String(call.arguments?.command || '')
    if (cmd === 'view') return 'read_file'
    if (cmd === 'create') return 'write_file'
    return 'edit_file'
  }
  if (call.name === BASH_NAME) return 'shell_exec'
  return null
}

/** True when a call edits files (drives the done-gate / verification). */
export function isFileMutation(call: Pick<ToolCall, 'name' | 'arguments'>): boolean {
  if (call.name === 'edit_file' || call.name === 'write_file' || call.name === 'delete_file' || call.name === APPLY_PATCH_NAME) return true
  if (call.name === 'lsp_rename' || call.name === 'lsp_apply_code_action' || call.name === 'checkpoint_restore') return true
  if (call.name === TEXT_EDITOR_NAME) return String(call.arguments?.command || '') !== 'view'
  return false
}

/** Paths a call reads or writes (for summaries, stale reminders, profiles). */
export function callPaths(call: Pick<ToolCall, 'name' | 'arguments'>): string[] {
  const a = call.arguments || {}
  if (call.name === APPLY_PATCH_NAME) {
    const text = String(a.input || a.patch || '')
    const out: string[] = []
    const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) out.push((m[1] || m[2]).trim())
    return out
  }
  const p = a.path || a.file_path
  return typeof p === 'string' && p ? [p] : []
}
