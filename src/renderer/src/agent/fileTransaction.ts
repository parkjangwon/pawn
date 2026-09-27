/**
 * Multi-file writes as one unit (apply_patch, LSP rename / code actions,
 * checkpoint restore): every file is recorded in the change ledger (undo),
 * snapshots stay in sync (stale-write protection), and a failure part-way
 * rolls back the files already written.
 */

import { useChangeLedger } from '../stores/changeLedger'
import { formatVerifyNote, verifyEditedSource } from './editVerify'
import { clearRepoMapCache } from './repoMap'
import { forgetFile, noteFileSeen, snapshotScope } from './fileSnapshots'
import { postEditDiagnostics } from './toolHandlers/lsp'
import type { ToolExecContext } from './toolHandlers/types'
import type { ToolResult } from './toolDefinitionsTypes'

export interface FileWrite {
  path: string
  /** Content before (null = file did not exist). */
  before: string | null
  /** Content after (null = delete the file). */
  after: string | null
}

export interface CommitResult {
  ok: boolean
  error?: string
  /** Per-file verification / diagnostics notes. */
  notes: string
  diffData?: ToolResult['diffData']
}

/** 1-based line/column (UTF-16 columns) text edits applied to one document. */
export interface TextEdit {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}

function offsetOf(lineStarts: number[], text: string, line: number, column: number): number {
  if (line - 1 >= lineStarts.length) return text.length
  const start = lineStarts[Math.max(0, line - 1)]
  const nextStart = line < lineStarts.length ? lineStarts[line] : text.length + 1
  // Column past the end of the line clamps to the line end (before its newline).
  const lineEnd = Math.max(start, nextStart - 1)
  return Math.min(start + Math.max(0, column - 1), lineEnd)
}

/** Apply LSP-style edits; overlapping edits are an error. */
export function applyTextEdits(text: string, edits: TextEdit[]): { ok: true; text: string } | { ok: false; error: string } {
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const ranges = edits
    .map((e) => ({ from: offsetOf(lineStarts, text, e.startLine, e.startColumn), to: offsetOf(lineStarts, text, e.endLine, e.endColumn), newText: e.newText }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from < ranges[i - 1].to) return { ok: false, error: 'Overlapping edits in one file' }
  }
  let out = text
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]
    out = out.slice(0, r.from) + r.newText + out.slice(r.to)
  }
  return { ok: true, text: out }
}

/** Write all files or none (best-effort rollback), then record + verify. */
export async function commitFileWrites(
  writes: FileWrite[],
  opts: { projectPath?: string; ctx?: ToolExecContext; toolCallId: string; api: typeof window.api; diagnostics?: boolean }
): Promise<CommitResult> {
  const { api } = opts
  const done: FileWrite[] = []
  for (const w of writes) {
    const res = w.after === null ? await api.fs.delete(w.path) : await api.fs.writeFile(w.path, w.after)
    const error = res && typeof res === 'object' && 'error' in res ? (res as { error?: string }).error : undefined
    if (error) {
      // Undo what already landed so the tree is never half-patched.
      for (const d of done.reverse()) {
        try {
          if (d.before === null) await api.fs.delete(d.path)
          else await api.fs.writeFile(d.path, d.before)
        } catch {
          /* best effort */
        }
      }
      return { ok: false, error: `${w.path}: ${error}${done.length ? ' (earlier files in this change were rolled back)' : ''}`, notes: '' }
    }
    done.push(w)
  }
  const scope = snapshotScope(opts.ctx)
  const ledger = useChangeLedger.getState()
  const notes: string[] = []
  let diagnosed = 0
  for (const w of writes) {
    ledger.recordChange({
      path: w.path,
      before: w.before,
      after: w.after ?? undefined,
      op: w.after === null ? 'delete' : w.before === null ? 'write' : 'edit',
      toolCallId: opts.toolCallId
    })
    if (w.after === null) {
      forgetFile(scope, w.path)
      continue
    }
    noteFileSeen(scope, w.path, w.after)
    const verify = formatVerifyNote(w.path, verifyEditedSource(w.path, w.after))
    if (verify) notes.push(verify.trim())
    if (opts.diagnostics !== false && diagnosed < 4) {
      diagnosed++
      const lsp = await postEditDiagnostics(w.path, w.after, opts.projectPath)
      if (lsp) notes.push(`${w.path.split('/').pop()}: ${lsp.trim()}`)
    }
  }
  clearRepoMapCache(opts.projectPath)
  const first = writes.find((w) => w.after !== null) || writes[0]
  return {
    ok: true,
    notes: notes.length ? `\n${notes.join('\n')}` : '',
    ...(first
      ? {
          diffData: {
            oldText: first.before ?? '',
            newText: first.after ?? '',
            filename: first.path.split('/').pop() || first.path,
            path: first.path
          }
        }
      : {})
  }
}

/** Relative path for messages. */
export function relPath(path: string, root?: string): string {
  if (root && path.startsWith(root.endsWith('/') ? root : `${root}/`)) return path.slice(root.length + (root.endsWith('/') ? 0 : 1))
  return path
}
