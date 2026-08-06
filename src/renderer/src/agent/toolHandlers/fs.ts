import { resolveToolPath, formatFileRead } from '../pathUtils'
import { applyEdit } from '../editUtils'
import { useChangeLedger } from '../../stores/changeLedger'
import { compileGlob, matchesGlob } from '../globMatch'
import { formatVerifyNote, verifyEditedSource } from '../editVerify'
import { clearRepoMapCache } from '../repoMap'
import type { ToolHandler } from './types'

const read_spreadsheet: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  const filePath = resolveToolPath(call.arguments.path as string, projectPath)
  if (!api.fs.readSpreadsheet) {
    return { toolCallId: call.id, content: 'Spreadsheet reading is unavailable in this environment.', isError: true }
  }
  const res = await api.fs.readSpreadsheet(filePath, {
    sheet: call.arguments.sheet ? String(call.arguments.sheet) : undefined,
    maxRows: call.arguments.max_rows !== undefined ? Number(call.arguments.max_rows) : undefined,
    maxCols: call.arguments.max_cols !== undefined ? Number(call.arguments.max_cols) : undefined
  })
  if (res.error) {
    return { toolCallId: call.id, content: res.error, isError: true }
  }
  const header = [
    `Spreadsheet: ${res.path}`,
    `format=${res.format}`,
    res.sheet ? `sheet=${res.sheet}` : null,
    res.sheets?.length ? `sheets=[${res.sheets.join(', ')}]` : null,
    `rows=${res.rowCount} cols=${res.colCount}`,
    res.truncated ? 'truncated=true (increase max_rows/max_cols carefully)' : 'truncated=false'
  ].filter(Boolean).join('\n')
  const body = res.previewMarkdown || ''
  try {
    const { useArtifactsStore } = await import('../../stores/artifacts')
    useArtifactsStore.getState().add({
      title: filePath.split('/').pop() || filePath,
      kind: 'table',
      path: filePath,
      preview: body.slice(0, 1500),
      source: 'read_spreadsheet'
    })
  } catch { /* ignore */ }
  return { toolCallId: call.id, content: `${header}\n\n${body}` }
}

const read_file: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const filePath = resolveToolPath(call.arguments.path as string, projectPath)
        const result = await api.fs.readFile(filePath)
        if (typeof result === 'object' && 'error' in result) {
          // Attempt fuzzy suggestion from the parent directory
          const parent = filePath.split('/').slice(0, -1).join('/') || '/'
          if (parent && parent !== filePath) {
            try {
              const listing = await api.fs.listDir(parent)
              if (Array.isArray(listing)) {
                const target = filePath.split('/').pop() || ''
                const similar = listing
                  .filter((e) => e.name.toLowerCase().includes(target.toLowerCase().slice(0, 3)) || target.toLowerCase().includes(e.name.toLowerCase().slice(0, 3)))
                  .slice(0, 5)
                  .map((e) => e.name)
                if (similar.length > 0) {
                  return { toolCallId: call.id, content: `File not found: ${filePath}\n\nDid you mean one of these?\n${similar.map((s) => `  - ${parent}/${s}`).join('\n')}`, isError: true }
                }
              }
            } catch { /* listing may fail, fall through */ }
          }
          return { toolCallId: call.id, content: result.error, isError: true }
        }
        const offset = call.arguments.offset !== undefined ? Number(call.arguments.offset) : undefined
        const limit = call.arguments.limit !== undefined ? Number(call.arguments.limit) : undefined
        return {
          toolCallId: call.id,
          content: formatFileRead(result as string, { offset, limit })
        }
      }


const write_file: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const wPath = resolveToolPath(call.arguments.path as string, projectPath)
        const newContent = call.arguments.content as string
        const existing = await api.fs.readFile(wPath)
        const before = typeof existing === 'string' ? existing : null
        const result = await api.fs.writeFile(wPath, newContent)
        if ('error' in result) {
          return { toolCallId: call.id, content: result.error!, isError: true }
        }
        const filename = wPath.split('/').pop() || wPath
        useChangeLedger.getState().recordChange({
          path: wPath,
          before,
          after: newContent,
          op: 'write',
          toolCallId: call.id
        })
        clearRepoMapCache(projectPath)
        const note = formatVerifyNote(wPath, verifyEditedSource(wPath, newContent))
        if (before !== null) {
          return {
            toolCallId: call.id,
            content: `File written: ${wPath}${note}`,
            diffData: { oldText: before, newText: newContent, filename, path: wPath }
          }
        }
        return {
          toolCallId: call.id,
          content: `File created: ${wPath}${note}`,
          diffData: { oldText: '', newText: newContent, filename, path: wPath }
        }
      }


const edit_file: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const path = resolveToolPath(call.arguments.path as string, projectPath)
        const oldStr = call.arguments.old_string as string
        const newStr = call.arguments.new_string as string
        const replaceAll = Boolean(call.arguments.replace_all)
        const fileContent = await api.fs.readFile(path)
        if (typeof fileContent === 'object' && 'error' in fileContent) {
          return { toolCallId: call.id, content: fileContent.error, isError: true }
        }
        const before = fileContent as string
        const applied = applyEdit(before, oldStr, newStr, replaceAll)
        if (!applied.ok) {
          return {
            toolCallId: call.id,
            content: applied.hint ? `${applied.error}\n${applied.hint}` : applied.error,
            isError: true
          }
        }
        const writeResult = await api.fs.writeFile(path, applied.updated)
        if ('error' in writeResult) {
          return { toolCallId: call.id, content: writeResult.error!, isError: true }
        }
        const filename = path.split('/').pop() || path
        const modeNote = applied.mode === 'flex_ws' ? ', whitespace-flex match' : ''
        useChangeLedger.getState().recordChange({
          path,
          before,
          after: applied.updated,
          op: 'edit',
          toolCallId: call.id
        })
        clearRepoMapCache(projectPath)
        const note = formatVerifyNote(path, verifyEditedSource(path, applied.updated))
        return {
          toolCallId: call.id,
          content: `File edited: ${path} (${applied.replacements} replacement${applied.replacements > 1 ? 's' : ''}${modeNote})${note}`,
          diffData: { oldText: before, newText: applied.updated, filename, path }
        }
      }


const delete_file: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const path = resolveToolPath(call.arguments.path as string, projectPath)
        const existing = await api.fs.readFile(path)
        const before = typeof existing === 'string' ? existing : null
        const result = await api.fs.delete(path)
        if (result && 'error' in result && result.error) {
          return { toolCallId: call.id, content: result.error, isError: true }
        }
        useChangeLedger.getState().recordChange({
          path,
          before,
          after: undefined,
          op: 'delete',
          toolCallId: call.id
        })
        return { toolCallId: call.id, content: `Deleted: ${path}` }
      }


const list_dir: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const dirPath = resolveToolPath(
          (call.arguments.path as string) || projectPath || '.',
          projectPath
        )
        const result = await api.fs.listDir(dirPath)
        if (Array.isArray(result)) {
          const listing = result.map((e) => `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          return { toolCallId: call.id, content: listing || '(empty)' }
        }
        return { toolCallId: call.id, content: (result as { error: string }).error, isError: true }
      }


const search_files: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const pattern = call.arguments.pattern as string
        const rootPath = resolveToolPath(
          (call.arguments.rootPath as string) || projectPath || '',
          projectPath
        )
        if (!rootPath || rootPath === '.') return { toolCallId: call.id, content: 'No project path set', isError: true }
        const maxResults = Math.min(300, Math.max(1, Number(call.arguments.max_results) || 80))
        const walkResult = await window.api.fs.walk(rootPath)
        if (!Array.isArray(walkResult)) {
          return { toolCallId: call.id, content: (walkResult as { error: string }).error, isError: true }
        }
        // Match against the path relative to the search root so **/*.ts and
        // src/**/*.css work as expected.
        // Normalize separators on both sides so Windows paths (backslashes)
        // compare and glob consistently with forward-slash patterns.
        const root = (rootPath.endsWith('/') || rootPath.endsWith('\\') ? rootPath : rootPath + '/').replace(/\\/g, '/')
        const compiledPattern = compileGlob(pattern)
        const files = walkResult.filter((f) => {
          if (f.isDirectory) return false
          const pathNorm = f.path.replace(/\\/g, '/')
          const rel = pathNorm.startsWith(root) ? pathNorm.slice(root.length) : f.name
          return matchesGlob(rel, pattern, compiledPattern) || matchesGlob(f.name, pattern, compiledPattern)
        })
        if (files.length === 0) return { toolCallId: call.id, content: 'No files found matching: ' + pattern }
        const shown = files.slice(0, maxResults)
        const more = files.length > maxResults ? `\n...(${files.length - maxResults} more)` : ''
        return {
          toolCallId: call.id,
          content: `Found ${files.length} files:\n${shown.map((f) => f.path).join('\n')}${more}`
        }
      }


const grep_search: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const query = call.arguments.query as string
        const filePattern = (call.arguments.pattern as string) || ''
        const grepRoot = resolveToolPath(
          (call.arguments.rootPath as string) || projectPath || '',
          projectPath
        )
        if (!grepRoot || grepRoot === '.') return { toolCallId: call.id, content: 'No project path set', isError: true }
        const caseInsensitive = Boolean(call.arguments.case_insensitive)
        const fixedString = Boolean(call.arguments.fixed_string)
        const contextLines = Math.min(3, Math.max(0, Number(call.arguments.context_lines) || 0))
        const maxMatches = Math.min(200, Math.max(1, Number(call.arguments.max_matches) || 80))

        // Fast path: ripgrep / git-grep in main (orders of magnitude faster on large repos).
        if (window.api.fs.contentSearch && query && query.length <= 512) {
          try {
            const fast = await window.api.fs.contentSearch(grepRoot, {
              query,
              fixedString,
              caseInsensitive,
              glob: filePattern || undefined,
              maxMatches,
              contextLines,
              timeoutMs: 15_000
            })
            if (fast.engine !== 'none') {
              if (fast.error && fast.matches.length === 0) {
                return { toolCallId: call.id, content: fast.error, isError: true }
              }
              const body =
                fast.text ||
                (fast.matches.length === 0
                  ? `No matches for ${JSON.stringify(query)}`
                  : fast.matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n'))
              return { toolCallId: call.id, content: body }
            }
          } catch {
            // fall through to walk-based scan
          }
        }

        const walkResult2 = await window.api.fs.walk(grepRoot)
        if (!Array.isArray(walkResult2)) {
          return { toolCallId: call.id, content: (walkResult2 as { error: string }).error, isError: true }
        }
        const grepRoot2 = (grepRoot.endsWith('/') || grepRoot.endsWith('\\') ? grepRoot : grepRoot + '/').replace(/\\/g, '/')
        const compiledFilePattern = filePattern ? compileGlob(filePattern) : null
        const candidates = filePattern
          ? walkResult2.filter((f) => {
              if (f.isDirectory) return false
              const pathNorm = f.path.replace(/\\/g, '/')
              const rel = pathNorm.startsWith(grepRoot2) ? pathNorm.slice(grepRoot2.length) : f.name
              return matchesGlob(rel, filePattern, compiledFilePattern) || matchesGlob(f.name, filePattern, compiledFilePattern)
            })
          : walkResult2.filter((f) => !f.isDirectory)
        let regex: RegExp
        try {
          if (query.length > 512) throw new Error('pattern too long')
          const source = fixedString ? query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : query
          regex = new RegExp(source, caseInsensitive ? 'gi' : 'g')
        } catch {
          return {
            toolCallId: call.id,
            content: query.length > 512 ? 'Pattern too long (max 512 chars)' : 'Invalid regex pattern: ' + query,
            isError: true
          }
        }
        const matches: string[] = []
        let skippedLongLines = 0
        let truncated = false
        // Prefer source-like files first so node_modules-less walks still hit app code early.
        const ranked = [...candidates].sort((a, b) => {
          const score = (p: string): number => {
            if (/\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|vue|svelte)$/i.test(p)) return 0
            if (/\.(md|json|ya?ml|toml|css|scss)$/i.test(p)) return 1
            return 2
          }
          return score(a.path) - score(b.path) || a.path.localeCompare(b.path)
        })
        const reads = await window.api.fs.readFiles(ranked.slice(0, 400).map((f) => f.path))
        for (const item of reads) {
          if (matches.length >= maxMatches) {
            truncated = true
            break
          }
          if (typeof item.content !== 'string') continue
          const lines = item.content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxMatches) {
              truncated = true
              break
            }
            // Minified files can have megabyte lines; skip to avoid catastrophic backtracking.
            if (lines[i].length > 20_000) {
              skippedLongLines++
              continue
            }
            regex.lastIndex = 0
            if (!regex.test(lines[i])) continue
            if (contextLines > 0) {
              const from = Math.max(0, i - contextLines)
              const to = Math.min(lines.length - 1, i + contextLines)
              for (let j = from; j <= to; j++) {
                const mark = j === i ? ':' : '-'
                matches.push(`${item.path}${mark}${j + 1}: ${lines[j].slice(0, 300)}`)
              }
              matches.push('--')
            } else {
              matches.push(`${item.path}:${i + 1}: ${lines[i].slice(0, 400)}`)
            }
          }
        }
        if (matches.length === 0) return { toolCallId: call.id, content: 'No matches found for: ' + query }
        const body = matches.join('\n')
        const notes: string[] = []
        if (truncated) notes.push(`truncated at ${maxMatches} matches`)
        if (skippedLongLines > 0) notes.push(`${skippedLongLines} lines over 20k chars skipped`)
        if (ranked.length > 400) notes.push(`scanned first 400 of ${ranked.length} candidate files`)
        const footer = notes.length ? `\n...(${notes.join('; ')})` : ''
        const cap = 16_000
        const clipped = body.length > cap ? body.slice(0, cap) + `\n...(output truncated)` : body
        return { toolCallId: call.id, content: clipped + footer }
      }


export const fsHandlers: Record<string, ToolHandler> = {
  read_spreadsheet,
  read_file,
  write_file,
  edit_file,
  delete_file,
  list_dir,
  search_files,
  grep_search
}
