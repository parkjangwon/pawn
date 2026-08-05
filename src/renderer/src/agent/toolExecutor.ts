import { readSkill } from './skills'
import { installSkillFromRepo } from './skillInstaller'
import { getBrowserAgent, type BrowserAgent } from './browser'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useRoutineStore } from '../stores/routine'
import { checkPermission } from './toolPermission'
import { isMcpToolName, callMcpTool } from './mcp'
import { uid } from '../utils/uid'
import { resolveToolPath, formatFileRead } from './pathUtils'
import { applyEdit } from './editUtils'
import { useChangeLedger } from '../stores/changeLedger'
import { usePlanStore } from '../stores/plan'
import type { ToolCall, ToolResult } from './toolDefinitions'

async function requireBrowser(): Promise<{ agent: BrowserAgent } | { error: string }> {
  const agent = getBrowserAgent()
  if (!agent) {
    return { error: 'The embedded browser is only available in the desktop app.' }
  }
  const ready = await agent.ensure()
  if (ready.error) return { error: ready.error }
  // Surface the work: open the right panel on the browser tab so the page the
  // agent is driving is visible instead of happening off-screen.
  try {
    (window as any).__openRightPanelTab?.('browser')
  } catch {
    // No panel bridge (e.g. dev:web) — browsing still proceeds headlessly.
  }
  return { agent }
}

/** Convert a glob pattern to a RegExp (compile once per search, not per file). */
export function compileGlob(pattern: string): RegExp | null {
  // Convert a glob pattern to a RegExp that understands:
  //   **  — matches zero or more path segments (across / boundaries)
  //   *   — matches within a single path segment (no /)
  //   ?   — matches exactly one non-/ character
  let regexStr = pattern
    // Replace ** first so it does not collide with single *
    .replace(/\*{2,}/g, '__GLOBSTAR__')
    // Escape all special regex chars except the remaining * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Now translate glob tokens to regex
    .replace(/\?/g, '[^/]')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*')
  try {
    return new RegExp(`^${regexStr}$`, 'i')
  } catch {
    return null
  }
}

// Test a filename against a glob. Pass a precompiled pattern to avoid
// rebuilding the regex for every file in a large walk.
export function matchesGlob(name: string, pattern: string, compiled?: RegExp | null): boolean {
  const re = compiled !== undefined ? compiled : compileGlob(pattern)
  if (re) return re.test(name)
  return name.toLowerCase().includes(pattern.toLowerCase())
}

// Execute a tool call and return the result
export type ToolExecContext = { sessionId?: string }

export async function executeTool(
  call: ToolCall,
  projectPath?: string,
  signal?: AbortSignal,
  ctx?: ToolExecContext
): Promise<ToolResult> {
  const api = window.api

  if (signal?.aborted) {
    return { toolCallId: call.id, content: 'Tool was not executed (run aborted).', isError: true }
  }

  // Streamed JSON for tool args can arrive truncated; never run with silent {}.
  if (call.arguments && call.arguments.__parse_error === true) {
    return {
      toolCallId: call.id,
      content: `Invalid tool arguments for ${call.name}: ${String(call.arguments.__message || 'JSON parse failed')}\nRaw: ${String(call.arguments.__raw || '').slice(0, 300)}`,
      isError: true
    }
  }

  // Check permission before execution
  const permitted = await checkPermission(call.name, call.arguments, signal, projectPath)
  if (!permitted) {
    return { toolCallId: call.id, content: `Permission denied: ${call.name}`, isError: true }
  }

  try {
    if (isMcpToolName(call.name)) {
      return await callMcpTool(call.id, call.name, call.arguments, projectPath)
    }

    switch (call.name) {
      case 'read_spreadsheet': {
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
        // Also surface on the Artifacts shelf so humans can re-open the path.
        try {
          const { useArtifactsStore } = await import('../stores/artifacts')
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

      case 'read_file': {
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

      case 'write_file': {
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
        if (before !== null) {
          return {
            toolCallId: call.id,
            content: `File written: ${wPath}`,
            diffData: { oldText: before, newText: newContent, filename, path: wPath }
          }
        }
        return {
          toolCallId: call.id,
          content: `File created: ${wPath}`,
          diffData: { oldText: '', newText: newContent, filename, path: wPath }
        }
      }

      case 'edit_file': {
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
        return {
          toolCallId: call.id,
          content: `File edited: ${path} (${applied.replacements} replacement${applied.replacements > 1 ? 's' : ''}${modeNote})`,
          diffData: { oldText: before, newText: applied.updated, filename, path }
        }
      }

      case 'delete_file': {
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

      case 'list_dir': {
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

      case 'shell_exec': {
        const timeoutArg = Number(call.arguments.timeout)
        const timeoutMs = Number.isFinite(timeoutArg) && timeoutArg > 0
          ? Math.min(300_000, Math.max(5_000, timeoutArg * 1000))
          : undefined
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = cwd === '.' ? projectPath : cwd
        const background = Boolean(call.arguments.background)
        if (background) {
          const started = await api.shell.start(call.arguments.command as string, workDir)
          if (started.error || !started.jobId) {
            return {
              toolCallId: call.id,
              content: started.error || 'Failed to start background job',
              isError: true
            }
          }
          return {
            toolCallId: call.id,
            content: `Background job started: ${started.jobId}${started.pid ? ` (pid ${started.pid})` : ''}\nUse shell_poll with job_id to check output; shell_kill to stop.`
          }
        }
        const result = await api.shell.exec(
          call.arguments.command as string,
          workDir,
          timeoutMs
        )
        const parts = [result.stdout, result.stderr].filter(Boolean)
        if (result.killed) parts.push('(command killed — stopped or timed out)')
        const output = parts.join('\n')
        return {
          toolCallId: call.id,
          content: output || `(exit code: ${result.exitCode})`,
          isError: result.exitCode !== 0 || Boolean(result.killed)
        }
      }

      case 'shell_poll': {
        const jobId = String(call.arguments.job_id || call.arguments.jobId || '')
        const polled = await api.shell.poll(jobId)
        if (polled.error) {
          return { toolCallId: call.id, content: polled.error, isError: true }
        }
        const header = `[${polled.status}] ${polled.command || jobId} (${polled.elapsedMs || 0}ms)`
        const body = [polled.stdout, polled.stderr].filter(Boolean).join('\n')
        const foot =
          polled.status === 'exited'
            ? `\n(exit ${polled.exitCode}${polled.killed ? ', killed' : ''})`
            : ''
        return {
          toolCallId: call.id,
          content: (header + (body ? '\n' + body : '') + foot).slice(0, 24000)
        }
      }

      case 'shell_kill': {
        const jobId = String(call.arguments.job_id || call.arguments.jobId || '')
        const killed = await api.shell.kill(jobId)
        if (killed.error) {
          return { toolCallId: call.id, content: killed.error, isError: true }
        }
        return { toolCallId: call.id, content: `Killed job ${jobId}` }
      }

      case 'update_plan': {
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

      case 'git_log': {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
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

      case 'git_status': {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
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

      case 'git_diff': {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const pathArg = call.arguments.path ? resolveToolPath(String(call.arguments.path), projectPath) : ''
        const stagedOnly = Boolean(call.arguments.staged)
        const argsBase = stagedOnly
          ? ['diff', '--cached', '--no-color']
          : ['diff', 'HEAD', '--no-color']
        // For unstaged-only when not stagedOnly, show working tree vs index AND index vs HEAD
        // via `git diff HEAD` which covers both.
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
          content: text.length > cap ? text.slice(0, cap) + `\n...(truncated ${text.length - cap} chars)` : text
        }
      }

      case 'computer_screenshot': {
        const result = await api.computer.screenshot()
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: result.dataUrl || '' }
      }

      case 'computer_click': {
        const result = await api.computer.click(
          call.arguments.x as number,
          call.arguments.y as number
        )
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: `Clicked at (${call.arguments.x}, ${call.arguments.y})` }
      }

      case 'computer_type': {
        const result = await api.computer.type(call.arguments.text as string)
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: `Typed: ${call.arguments.text}` }
      }

      case 'computer_keypress': {
        const key = String(call.arguments.key || '')
        if (!key) return { toolCallId: call.id, content: 'key is required', isError: true }
        const result = await api.computer.keypress(key)
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: `Pressed key: ${key}` }
      }

      case 'browser_navigate': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.navigate(call.arguments.url as string)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return {
          toolCallId: call.id,
          content: `Loaded ${res.url}\nTitle: ${res.title || '(none)'}\n\nCall browser_snapshot to see the interactive elements.`
        }
      }

      case 'browser_snapshot': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.snapshot((call.arguments.filter as string) || '')
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        if (res.elements.length === 0) {
          return { toolCallId: call.id, content: `${res.url}\nNo interactive elements matched. The page may still be loading, or the content may be inside a cross-origin frame.` }
        }
        const lines = res.elements.map((e) => {
          const bits = [`[${e.ref}]`, e.role]
          if (e.text) bits.push(JSON.stringify(e.text))
          if (e.name) bits.push(`name=${e.name}`)
          if (e.placeholder) bits.push(`placeholder=${JSON.stringify(e.placeholder)}`)
          if (e.value) bits.push(`value=${JSON.stringify(e.value)}`)
          if (e.href) bits.push(`href=${e.href}`)
          return bits.join(' ')
        })
        return {
          toolCallId: call.id,
          content: `${res.title}\n${res.url}\n\n${lines.join('\n')}${res.truncated ? '\n...(more elements omitted; pass a filter to narrow)' : ''}`
        }
      }

      case 'browser_click': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.click(call.arguments.ref as string, call.arguments.selector as string)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.message }
      }

      case 'browser_fill': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.fill(
          call.arguments.ref as string,
          call.arguments.selector as string,
          String(call.arguments.value ?? ''),
          call.arguments.submit === true
        )
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.message }
      }

      case 'browser_read_text': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.readText((call.arguments.selector as string) || '')
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.text || '(no visible text)' }
      }

      case 'browser_eval': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.evaluate(call.arguments.code as string)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.result }
      }

      case 'browser_back': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.back()
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: `Went back to ${res.url}` }
      }

      case 'browser_screenshot': {
        const b = await requireBrowser()
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.screenshot()
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        // Return data URL so transcript maps it to a vision image block (same as computer_screenshot).
        if (res.dataUrl && res.dataUrl.startsWith('data:image/')) {
          return { toolCallId: call.id, content: res.dataUrl }
        }
        return {
          toolCallId: call.id,
          content: `[Screenshot captured, ${res.bytes} bytes — no image data returned]`
        }
      }

      case 'browser_open_external': {
        await api.browser.open(call.arguments.url as string)
        return { toolCallId: call.id, content: `Opened in the system browser: ${call.arguments.url}` }
      }

      case 'load_skill': {
        const name = call.arguments.name as string
        const content = await readSkill(projectPath, name)
        if (!content) return { toolCallId: call.id, content: `No skill named "${name}". Check the Available Skills list.`, isError: true }
        return { toolCallId: call.id, content }
      }

      case 'install_skill': {
        const repo = String(call.arguments.repo ?? '').trim()
        const scope = call.arguments.scope === 'project' ? 'project' : 'user'
        const res = await installSkillFromRepo(repo, scope, projectPath)
        return { toolCallId: call.id, content: res.content, isError: res.isError === true }
      }

      case 'search_files': {
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

      case 'grep_search': {
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

      case 'app_open_tab': {
        const tab = String(call.arguments.tab || '')
        const valid = ['terminal', 'files', 'git', 'browser', 'diff', 'artifacts']
        if (!valid.includes(tab)) {
          return { toolCallId: call.id, content: `Unknown tab "${tab}". Valid tabs: ${valid.join(', ')}`, isError: true }
        }
        try { (window as any).__openRightPanelTab?.(tab) } catch {}
        return { toolCallId: call.id, content: `Opened right panel on tab: ${tab}` }
      }

      case 'app_close_tab': {
        const tab = String(call.arguments.tab || '')
        const valid = ['terminal', 'files', 'git', 'browser', 'diff', 'artifacts']
        if (!valid.includes(tab)) {
          return { toolCallId: call.id, content: `Unknown tab "${tab}". Valid tabs: ${valid.join(', ')}`, isError: true }
        }
        try { (window as any).__closeRightPanelTab?.(tab) } catch {}
        return { toolCallId: call.id, content: `Closed tab: ${tab}` }
      }

      case 'app_list_automations': {
        if (!api.routine) {
          return { toolCallId: call.id, content: 'Automations are unavailable in this environment.', isError: true }
        }
        const rows = await api.routine.list()
        if (!Array.isArray(rows) || rows.length === 0) {
          return { toolCallId: call.id, content: 'No automations configured.' }
        }
        const lines = rows.map((r) => {
          const scheduleLabel = (() => {
            try {
              const parsed = JSON.parse(r.schedule) as { type?: string; minutes?: number; hour?: number; minute?: number; weekday?: number }
              if (parsed.type === 'interval') return `interval/${Math.max(1, Number(parsed.minutes) || 1)}m`
              if (parsed.type === 'weekly') return `weekly/${parsed.weekday ?? 0} ${String(parsed.hour ?? 0).padStart(2, '0')}:${String(parsed.minute ?? 0).padStart(2, '0')}`
              return `daily/${String(parsed.hour ?? 0).padStart(2, '0')}:${String(parsed.minute ?? 0).padStart(2, '0')}`
            } catch {
              return 'unknown'
            }
          })()
          return `- ${r.name} [${r.id}] enabled=${r.enabled ? 'yes' : 'no'} schedule=${scheduleLabel}`
        })
        return { toolCallId: call.id, content: `Automations (${rows.length}):\n${lines.join('\n')}` }
      }

      case 'app_create_automation': {
        if (!api.routine) {
          return { toolCallId: call.id, content: 'Automations are unavailable in this environment.', isError: true }
        }

        const name = String(call.arguments.name ?? '').trim()
        const prompt = String(call.arguments.prompt ?? '').trim()
        const scheduleType = String(call.arguments.scheduleType ?? '').trim()
        if (!name || !prompt) {
          return { toolCallId: call.id, content: 'name and prompt are required.', isError: true }
        }
        if (!['manual', 'interval', 'daily', 'weekly'].includes(scheduleType)) {
          return { toolCallId: call.id, content: 'scheduleType must be one of: manual, interval, daily, weekly.', isError: true }
        }

        const toInt = (v: unknown, fallback: number): number => {
          const n = Number(v)
          return Number.isFinite(n) ? Math.trunc(n) : fallback
        }
        const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

        const schedule: RoutineSchedule = (() => {
          if (scheduleType === 'interval') {
            const minutes = Math.max(1, toInt(call.arguments.intervalMinutes, 30))
            return { type: 'interval', minutes }
          }
          if (scheduleType === 'weekly') {
            const weekday = clamp(toInt(call.arguments.weekday, 1), 0, 6)
            const hour = clamp(toInt(call.arguments.hour, 9), 0, 23)
            const minute = clamp(toInt(call.arguments.minute, 0), 0, 59)
            return { type: 'weekly', weekday, hour, minute }
          }
          const hour = clamp(toInt(call.arguments.hour, 9), 0, 23)
          const minute = clamp(toInt(call.arguments.minute, 0), 0, 59)
          return { type: 'daily', hour, minute }
        })()

        const id = uid('routine-')
        const create = await api.routine.add({
          id,
          name,
          prompt,
          schedule: JSON.stringify(schedule),
          projectId: String(call.arguments.projectId ?? '').trim() || undefined,
          sessionId: String(call.arguments.sessionId ?? '').trim() || undefined
        })
        if (create?.error) {
          return { toolCallId: call.id, content: create.error, isError: true }
        }

        const requestedEnabled = call.arguments.enabled
        const shouldEnable = scheduleType === 'manual'
          ? false
          : requestedEnabled === undefined
            ? true
            : Boolean(requestedEnabled)

        if (!shouldEnable) {
          await api.routine.setEnabled(id, false)
        }

        await useRoutineStore.getState().refresh()

        const scheduleText = scheduleType === 'interval'
          ? `interval/${(schedule as { type: 'interval'; minutes: number }).minutes}m`
          : scheduleType === 'weekly'
            ? `weekly/${(schedule as { type: 'weekly'; weekday: number; hour: number; minute: number }).weekday} ${String((schedule as { type: 'weekly'; weekday: number; hour: number; minute: number }).hour).padStart(2, '0')}:${String((schedule as { type: 'weekly'; weekday: number; hour: number; minute: number }).minute).padStart(2, '0')}`
            : `daily/${String((schedule as { type: 'daily'; hour: number; minute: number }).hour).padStart(2, '0')}:${String((schedule as { type: 'daily'; hour: number; minute: number }).minute).padStart(2, '0')}`

        return {
          toolCallId: call.id,
          content: `Automation created: ${name} [${id}]\nEnabled: ${shouldEnable ? 'yes' : 'no'}\nSchedule: ${scheduleText}`
        }
      }

      case 'app_set_model': {
        const requested = String(call.arguments.model ?? '').trim()
        const { models, setActiveModel, setRoutingMode } = useProviderStore.getState()
        if (!requested || requested === 'auto') {
          setActiveModel(null)
          setRoutingMode('auto')
          return { toolCallId: call.id, content: 'Model set to auto (router picks per task)' }
        }
        const target = models.find((m) =>
          m.id === requested || m.modelId === requested || m.label === requested
        )
        if (!target) {
          const available = models.filter((m) => m.enabled).map((m) => m.label || m.modelId).join(', ')
          return {
            toolCallId: call.id,
            content: `Unknown model "${requested}". Configured models: ${available || '(none)'}`,
            isError: true
          }
        }
        setActiveModel(target.id)
        return { toolCallId: call.id, content: `Model set to ${target.label || target.modelId}` }
      }

      case 'app_set_permission_mode': {
        const mode = call.arguments.mode as 'ask' | 'auto' | 'yolo'
        if (!['ask', 'auto', 'yolo'].includes(mode)) {
          return { toolCallId: call.id, content: `Unknown permission mode "${mode}". Valid: ask, auto, yolo`, isError: true }
        }
        useProviderStore.getState().setPermissionMode(mode)
        return { toolCallId: call.id, content: `Permission mode set to ${mode}` }
      }

      case 'app_set_reasoning': {
        const effort = call.arguments.effort as 'auto' | 'low' | 'medium' | 'high'
        if (!['auto', 'low', 'medium', 'high'].includes(effort)) {
          return { toolCallId: call.id, content: `Unknown reasoning effort "${effort}". Valid: auto, low, medium, high`, isError: true }
        }
        useProviderStore.getState().setReasoningEffort(effort)
        return { toolCallId: call.id, content: `Reasoning effort set to ${effort}` }
      }

      case 'app_toggle_theme': {
        useThemeStore.getState().toggle()
        return { toolCallId: call.id, content: 'Theme toggled' }
      }

      case 'google_whoami':
      case 'google_drive_search':
      case 'google_drive_read':
      case 'google_gmail_search':
      case 'google_gmail_read':
      case 'google_calendar_list':
      case 'google_tasks_list':
      case 'google_sheets_read':
      case 'google_docs_read':
      case 'google_slides_read':
      case 'github_whoami':
      case 'github_list_repos':
      case 'github_get_repo':
      case 'github_list_issues':
      case 'github_get_issue':
      case 'github_list_pulls':
      case 'github_get_pull':
      case 'github_list_commits':
      case 'github_get_file':
      case 'github_search_code':
      case 'github_search_issues':
      case 'github_create_issue':
      case 'github_comment':
      case 'github_create_pull': {
        if (!api.connections?.runTool) {
          return {
            toolCallId: call.id,
            content: 'Service connections are only available in the desktop app.',
            isError: true
          }
        }
        const res = await api.connections.runTool(call.name, call.arguments || {})
        if (!res?.ok) {
          return {
            toolCallId: call.id,
            content: res?.error || res?.text || `${call.name} failed`,
            isError: true
          }
        }
        return { toolCallId: call.id, content: res.text || '(empty)' }
      }

      default:
        return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true }
    }
  } catch (err) {
    return { toolCallId: call.id, content: String(err), isError: true }
  }
}
