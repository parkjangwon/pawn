/**
 * Human-readable preview of what a tool call is about to do, for the
 * permission dialog: the target (file / command / URL) plus the content in its
 * natural form — file text, an edit as -/+ lines, a patch, a command — instead
 * of an escaped JSON blob.
 */

export type PermissionPreviewKind = 'file' | 'edit' | 'patch' | 'command' | 'delete' | 'fields'

export interface PermissionPreviewLine {
  text: string
  /** '+' added, '-' removed, ' ' context */
  mark?: '+' | '-' | ' '
}

export interface PermissionPreview {
  kind: PermissionPreviewKind
  /** Plain-language "what this does" (from the tool call's `purpose`). */
  purpose?: string
  /** Path, command working folder, URL … */
  target?: string
  /** Short summary shown next to the target (e.g. "42 lines"). */
  summary?: string
  lines: PermissionPreviewLine[]
  /** Lines not shown. */
  truncated?: number
}

const MAX_LINES = 40
const MAX_LINE_CHARS = 400

function clipLines(text: string, mark?: PermissionPreviewLine['mark'], max = MAX_LINES): { lines: PermissionPreviewLine[]; truncated: number } {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (all.length > 1 && all[all.length - 1] === '') all.pop()
  const shown = all.slice(0, max).map((l) => ({ text: l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l, ...(mark ? { mark } : {}) }))
  return { lines: shown, truncated: Math.max(0, all.length - shown.length) }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.replace(/\n$/, '').split('\n').length
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === undefined) return ''
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function buildPermissionPreview(
  callName: string,
  args: Record<string, unknown>,
  opts: { path?: string; lineUnit?: (n: number) => string } = {}
): PermissionPreview {
  const a = args || {}
  const unit = opts.lineUnit ?? ((n: number) => `${n} line${n === 1 ? '' : 's'}`)
  const path = opts.path || str(a.path) || str(a.file_path)

  // Whole-file writes (write_file, text editor create).
  const fileText = str(a.content) ?? str(a.file_text)
  if ((callName === 'write_file' || a.command === 'create') && fileText !== undefined) {
    const { lines, truncated } = clipLines(fileText)
    return { kind: 'file', target: path, summary: unit(lineCount(fileText)), lines, truncated }
  }

  // Targeted edits (edit_file, str_replace, insert).
  const oldText = str(a.old_string) ?? str(a.old_str)
  const newText = str(a.new_string) ?? str(a.new_str) ?? str(a.insert_text)
  if (callName === 'edit_file' && (oldText !== undefined || newText !== undefined)) {
    const removed = oldText ? clipLines(oldText, '-', 20) : { lines: [], truncated: 0 }
    const added = newText ? clipLines(newText, '+', 20) : { lines: [], truncated: 0 }
    const where = a.command === 'insert' && a.insert_line !== undefined ? ` · after line ${String(a.insert_line)}` : ''
    return {
      kind: 'edit',
      target: path,
      summary: `-${lineCount(oldText || '')} +${lineCount(newText || '')}${where}${a.replace_all ? ' · all occurrences' : ''}`,
      lines: [...removed.lines, ...added.lines],
      truncated: removed.truncated + added.truncated
    }
  }

  if (callName === 'apply_patch') {
    const patch = str(a.input) ?? str(a.patch) ?? ''
    const files = Array.from(patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)).map((m) => `${m[1][0]} ${m[2].trim()}`)
    const body = patch
      .split('\n')
      .filter((l) => !/^\*\*\* (Begin|End) Patch/.test(l))
      .join('\n')
    const { lines, truncated } = clipLines(body, undefined, 60)
    return {
      kind: 'patch',
      summary: files.join(', ').slice(0, 200),
      lines: lines.map((l) => ({ ...l, mark: l.text.startsWith('+') ? '+' : l.text.startsWith('-') ? '-' : ' ' })),
      truncated
    }
  }

  if (callName === 'delete_file') return { kind: 'delete', target: path, lines: [] }

  const command = str(a.command)
  if ((callName === 'shell_exec' || callName.startsWith('shell_') || callName === 'bash') && command) {
    const { lines, truncated } = clipLines(command, undefined, 30)
    const flags = [a.background ? 'background' : '', a.network === false ? 'network off' : '', str(a.cwd) ? `in ${String(a.cwd)}` : '']
      .filter(Boolean)
      .join(' · ')
    const purpose = str(a.purpose)?.trim().slice(0, 240)
    return { kind: 'command', ...(purpose ? { purpose } : {}), ...(flags ? { summary: flags } : {}), lines, truncated }
  }

  // Everything else: one "key: value" row per argument, strings unescaped.
  const lines: PermissionPreviewLine[] = []
  let truncated = 0
  const entries = Object.entries(a).filter(([k]) => !k.startsWith('__'))
  for (let i = 0; i < entries.length; i++) {
    const [k, v] = entries[i]
    const value = formatValue(v)
    const parts = value.split('\n')
    const first = parts[0].length > MAX_LINE_CHARS ? `${parts[0].slice(0, MAX_LINE_CHARS)}…` : parts[0]
    lines.push({ text: `${k}: ${first}` })
    for (const extra of parts.slice(1, 8)) lines.push({ text: `  ${extra.slice(0, MAX_LINE_CHARS)}` })
    if (parts.length > 8) truncated += parts.length - 8
    if (lines.length >= MAX_LINES) {
      truncated += entries.length - i - 1
      break
    }
  }
  return { kind: 'fields', target: path, lines, truncated }
}
