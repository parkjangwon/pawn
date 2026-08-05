import { readSkill } from './skills'
import { installSkillFromRepo } from './skillInstaller'
import { getBrowserAgent, type BrowserAgent } from './browser'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useRoutineStore } from '../stores/routine'
import { checkPermission } from './toolPermission'
import { fireHook } from './hooksClient'
import { isMcpToolName, callMcpTool } from './mcp'
import { uid } from '../utils/uid'
import { resolveToolPath, formatFileRead } from './pathUtils'
import { applyEdit } from './editUtils'
import { useChangeLedger } from '../stores/changeLedger'
import { usePlanStore } from '../stores/plan'
import type { ToolCall, ToolResult } from './toolDefinitions'
import { runProjectChecks } from './runChecks'
import { searchCodebase } from './codebaseSearch'
import { gitPrReady } from './gitPrReady'
import { listArtifacts, writeArtifact } from './artifacts'

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

  // PreToolUse hooks — can deny even in YOLO (policy / external integrations).
  if (!signal?.aborted) {
    const pre = await fireHook({
      event: 'PreToolUse',
      sessionId: ctx?.sessionId,
      projectPath: projectPath || null,
      cwd: projectPath || undefined,
      payload: {
        tool_name: call.name,
        tool_use_id: call.id,
        tool_input: call.arguments
      }
    })
    if (pre.decision === 'deny') {
      return {
        toolCallId: call.id,
        content: `Blocked by hook (PreToolUse): ${pre.reason || call.name}`,
        isError: true
      }
    }
  }

  // Check permission before execution
  const permitted = await checkPermission(call.name, call.arguments, signal, projectPath, {
    sessionId: ctx?.sessionId,
    cwd: projectPath
  })
  if (!permitted) {
    return { toolCallId: call.id, content: `Permission denied: ${call.name}`, isError: true }
  }

  try {
    let result: ToolResult
    if (isMcpToolName(call.name)) {
      result = await callMcpTool(call.id, call.name, call.arguments, projectPath)
    } else {
      result = await executeToolBody(call, projectPath, signal, ctx, api)
    }

    // PostToolUse — advisory; never undoes side effects
    if (!signal?.aborted && window.api?.hooks?.run) {
      void fireHook({
        event: 'PostToolUse',
        sessionId: ctx?.sessionId,
        projectPath: projectPath || null,
        cwd: projectPath || undefined,
        payload: {
          tool_name: call.name,
          tool_use_id: call.id,
          tool_input: call.arguments,
          tool_response: {
            content: String(result.content || '').slice(0, 8000),
            isError: result.isError === true
          }
        }
      })
    }
    return result
  } catch (err) {
    return {
      toolCallId: call.id,
      content: `Tool error (${call.name}): ${String(err)}`,
      isError: true
    }
  }
}

async function executeToolBody(
  call: ToolCall,
  projectPath: string | undefined,
  _signal: AbortSignal | undefined,
  ctx: ToolExecContext | undefined,
  api: typeof window.api
): Promise<ToolResult> {
  try {
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

      case 'git_pr_ready': {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const base = call.arguments.base ? String(call.arguments.base) : undefined
        const text = await gitPrReady(workDir, base)
        return { toolCallId: call.id, content: text }
      }

      case 'run_checks': {
        const cwd = resolveToolPath(
          (call.arguments.cwd as string) || projectPath || undefined,
          projectPath
        )
        const workDir = !cwd || cwd === '.' ? projectPath : cwd
        if (!workDir) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const kindRaw = String(call.arguments.kind || 'all')
        const kind = (['all', 'typecheck', 'test', 'lint', 'build'].includes(kindRaw)
          ? kindRaw
          : 'all') as 'all' | 'typecheck' | 'test' | 'lint' | 'build'
        const timeout = call.arguments.timeout !== undefined ? Number(call.arguments.timeout) : 120
        const text = await runProjectChecks(workDir, kind, timeout)
        return { toolCallId: call.id, content: text }
      }

      case 'codebase_search': {
        const root = resolveToolPath(
          (call.arguments.rootPath as string) || projectPath || '',
          projectPath
        )
        if (!root || root === '.') {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const text = await searchCodebase(root, String(call.arguments.query || ''), {
          maxResults:
            call.arguments.max_results !== undefined ? Number(call.arguments.max_results) : undefined,
          pathGlob: call.arguments.path_glob ? String(call.arguments.path_glob) : undefined
        })
        return { toolCallId: call.id, content: text, isError: text.startsWith('query is required') }
      }

      case 'write_artifact': {
        if (!projectPath) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const name = String(call.arguments.name || '')
        const content = String(call.arguments.content ?? '')
        const res = await writeArtifact(projectPath, name, content)
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'write failed', isError: true }
        return { toolCallId: call.id, content: `Wrote artifact: ${res.path}` }
      }

      case 'list_artifacts': {
        if (!projectPath) {
          return { toolCallId: call.id, content: 'No project path set', isError: true }
        }
        const sub = call.arguments.subdir ? String(call.arguments.subdir) : ''
        return { toolCallId: call.id, content: await listArtifacts(projectPath, sub) }
      }

      case 'terminal_list': {
        if (!api.terminal?.list) {
          return {
            toolCallId: call.id,
            content: 'Terminal list is only available in the desktop app.',
            isError: true
          }
        }
        const res = await api.terminal.list()
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'list failed', isError: true }
        const terms = res.terminals || []
        if (!terms.length) {
          return {
            toolCallId: call.id,
            content: 'No terminal sessions. Open the terminal panel first.'
          }
        }
        return {
          toolCallId: call.id,
          content: terms
            .map((t) => `- id=${t.id} alive=${t.alive} bufferChars=${t.bufferChars}`)
            .join('\n')
        }
      }

      case 'terminal_read': {
        if (!api.terminal?.readBuffer) {
          return {
            toolCallId: call.id,
            content: 'Terminal read is only available in the desktop app.',
            isError: true
          }
        }
        let id = call.arguments.id ? String(call.arguments.id) : ''
        if (!id && api.terminal.list) {
          const listed = await api.terminal.list()
          id = listed.terminals?.[0]?.id || ''
        }
        if (!id) {
          return {
            toolCallId: call.id,
            content: 'No terminal id. Open a terminal or pass id from terminal_list.',
            isError: true
          }
        }
        const res = await api.terminal.readBuffer(
          id,
          call.arguments.max_chars !== undefined ? Number(call.arguments.max_chars) : undefined
        )
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'read failed', isError: true }
        return {
          toolCallId: call.id,
          content: [
            `terminal id=${res.id} alive=${res.alive}`,
            `returnedChars=${res.returnedChars} rawChars=${res.rawChars}`,
            '',
            res.text || '(empty buffer)'
          ].join('\n')
        }
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
        if (!api.computer?.screenshot) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.screenshot({
          displayId: call.arguments.display_id != null ? Number(call.arguments.display_id) : undefined,
          maxWidth: call.arguments.max_width != null ? Number(call.arguments.max_width) : undefined
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        const meta = [
          `display=${result.displayId ?? '?'} ${result.displayLabel || ''}`.trim(),
          `image=${result.width}x${result.height}`,
          `screen=${result.screenWidth}x${result.screenHeight}`,
          `scaleFactor=${result.scaleFactor ?? 1}`,
          'coord_space=image (top-left). Use same space for computer_click/drag/scroll unless coord_space=screen.'
        ].join('\n')
        // Meta text + data URL: transcript maps the data URL to a vision image block.
        return {
          toolCallId: call.id,
          content: `${meta}\n${result.dataUrl || ''}`
        }
      }

      case 'computer_displays': {
        if (!api.computer?.displays) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const res = await api.computer.displays()
        const list = res.displays || []
        if (!list.length) return { toolCallId: call.id, content: 'No displays found.', isError: true }
        const lines = list.map(
          (d) =>
            `- id=${d.id}${d.primary ? ' (primary)' : ''}: ${d.label} ${d.width}x${d.height}`
        )
        return { toolCallId: call.id, content: `# Displays\n${lines.join('\n')}` }
      }

      case 'computer_click': {
        if (!api.computer?.click) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.click(Number(call.arguments.x), Number(call.arguments.y), {
          button: call.arguments.button != null ? String(call.arguments.button) : undefined,
          clicks: call.arguments.clicks != null ? Number(call.arguments.clicks) : undefined,
          coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined,
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return {
          toolCallId: call.id,
          content: `Clicked (${result.x}, ${result.y}) button=${call.arguments.button || 'left'} clicks=${call.arguments.clicks || 1}`
        }
      }

      case 'computer_move': {
        if (!api.computer?.move) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.move(Number(call.arguments.x), Number(call.arguments.y), {
          coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: `Moved mouse to (${result.x}, ${result.y})` }
      }

      case 'computer_drag': {
        if (!api.computer?.drag) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.drag(
          Number(call.arguments.from_x),
          Number(call.arguments.from_y),
          Number(call.arguments.to_x),
          Number(call.arguments.to_y),
          {
            button: call.arguments.button != null ? String(call.arguments.button) : undefined,
            steps: call.arguments.steps != null ? Number(call.arguments.steps) : undefined,
            coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined,
            returnScreenshot: call.arguments.return_screenshot === true
          }
        )
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return {
          toolCallId: call.id,
          content: `Dragged (${call.arguments.from_x},${call.arguments.from_y}) → (${call.arguments.to_x},${call.arguments.to_y})`
        }
      }

      case 'computer_scroll': {
        if (!api.computer?.scroll) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.scroll(Number(call.arguments.x), Number(call.arguments.y), {
          dy: call.arguments.dy != null ? Number(call.arguments.dy) : undefined,
          dx: call.arguments.dx != null ? Number(call.arguments.dx) : undefined,
          coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined,
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return {
          toolCallId: call.id,
          content: `Scrolled at (${call.arguments.x},${call.arguments.y}) dy=${call.arguments.dy ?? 0} dx=${call.arguments.dx ?? 0}`
        }
      }

      case 'computer_type': {
        if (!api.computer?.type) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const text = String(call.arguments.text || '')
        const result = await api.computer.type(text, {
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return { toolCallId: call.id, content: `Typed ${text.length} chars` }
      }

      case 'computer_keypress': {
        if (!api.computer?.keypress) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const key = String(call.arguments.key || '')
        if (!key) return { toolCallId: call.id, content: 'key is required', isError: true }
        const result = await api.computer.keypress(key, {
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return { toolCallId: call.id, content: `Pressed key: ${key}` }
      }

      case 'computer_clipboard': {
        if (!api.computer?.clipboard) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const action = String(call.arguments.action || 'get')
        const res = await api.computer.clipboard(
          action,
          call.arguments.text != null ? String(call.arguments.text) : undefined
        )
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        if (action === 'get' || action === 'read') {
          return { toolCallId: call.id, content: res.text ?? '' }
        }
        return { toolCallId: call.id, content: 'Clipboard updated' }
      }

      case 'computer_wait': {
        if (!api.computer?.wait) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const ms = Number(call.arguments.ms)
        const res = await api.computer.wait(ms)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: `Waited ${res.ms}ms` }
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

      case 'web_fetch': {
        if (!api.research?.fetch) {
          return {
            toolCallId: call.id,
            content: 'Research tools are only available in the desktop app.',
            isError: true
          }
        }
        const url = String(call.arguments.url || '').trim()
        if (!url) {
          return { toolCallId: call.id, content: 'url is required', isError: true }
        }
        const res = await api.research.fetch(url, {
          maxAttempts:
            call.arguments.max_attempts !== undefined ? Number(call.arguments.max_attempts) : undefined,
          deviceClass: (['auto', 'desktop', 'mobile'].includes(String(call.arguments.device_class))
            ? String(call.arguments.device_class)
            : 'auto') as 'auto' | 'desktop' | 'mobile',
          includeTrace: call.arguments.include_trace === true
        })
        return {
          toolCallId: call.id,
          content: res.text || res.error || 'Empty research response',
          isError: !res.ok && !res.text
        }
      }

      case 'web_research': {
        if (!api.research?.research) {
          return {
            toolCallId: call.id,
            content: 'Research tools are only available in the desktop app.',
            isError: true
          }
        }
        const query = call.arguments.query !== undefined ? String(call.arguments.query) : ''
        const urls = Array.isArray(call.arguments.urls)
          ? (call.arguments.urls as unknown[]).map(String)
          : undefined
        if (!query.trim() && (!urls || !urls.length)) {
          return {
            toolCallId: call.id,
            content: 'Provide query and/or urls for web_research.',
            isError: true
          }
        }
        const res = await api.research.research({
          query: query.trim() || undefined,
          urls,
          maxSources:
            call.arguments.max_sources !== undefined ? Number(call.arguments.max_sources) : undefined,
          includeSearch:
            call.arguments.include_search !== undefined
              ? call.arguments.include_search === true
              : undefined
        })
        return {
          toolCallId: call.id,
          content: res.text || res.error || 'Empty research response',
          isError: !res.ok && !res.text
        }
      }

      case 'web_search': {
        if (!api.research?.search) {
          return {
            toolCallId: call.id,
            content: 'Web search is only available in the desktop app.',
            isError: true
          }
        }
        const q = String(call.arguments.query || '').trim()
        if (!q) return { toolCallId: call.id, content: 'query is required', isError: true }
        const res = await api.research.search({
          query: q,
          maxResults:
            call.arguments.max_results !== undefined ? Number(call.arguments.max_results) : undefined
        })
        return {
          toolCallId: call.id,
          content: res.text || res.error || 'Empty search response',
          isError: !res.ok && !res.text
        }
      }

      case 'memory_search': {
        if (!api.memory?.search) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const query = String(call.arguments.query || '').trim()
        if (!query) return { toolCallId: call.id, content: 'query is required', isError: true }
        const projectId = (await import('../stores/app')).useAppStore.getState().activeProjectId
        const list = await api.memory.search({
          query,
          kind: call.arguments.kind ? String(call.arguments.kind) : undefined,
          scope: call.arguments.scope ? String(call.arguments.scope) : undefined,
          projectId: projectId && projectId !== '__general__' ? projectId : null,
          limit: call.arguments.limit != null ? Number(call.arguments.limit) : 8
        })
        if (!Array.isArray(list) || !list.length) {
          return { toolCallId: call.id, content: `No memories matched ${JSON.stringify(query)}.` }
        }
        const lines = list.map(
          (h: {
            id: string
            kind: string
            title: string
            content: string
            score?: number
            tags?: string[]
            pinned?: boolean
          }, i: number) =>
            `${i + 1}. [${h.kind}${h.pinned ? ', pinned' : ''}] ${h.title}\n   id: ${h.id}\n   ${h.content}${h.tags?.length ? `\n   tags: ${h.tags.join(', ')}` : ''}${h.score != null ? `\n   score: ${h.score}` : ''}`
        )
        return {
          toolCallId: call.id,
          content: `# Memory search: ${query}\nmatches=${list.length}\n\n${lines.join('\n\n')}`
        }
      }

      case 'memory_save': {
        if (!api.memory?.save) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const content = String(call.arguments.content || '').trim()
        if (!content) return { toolCallId: call.id, content: 'content is required', isError: true }
        const projectId = (await import('../stores/app')).useAppStore.getState().activeProjectId
        const scopeArg = call.arguments.scope ? String(call.arguments.scope) : undefined
        const scope =
          scopeArg === 'user' || scopeArg === 'project'
            ? scopeArg
            : projectId && projectId !== '__general__'
              ? 'project'
              : 'user'
        const res = await api.memory.save({
          content,
          title: call.arguments.title != null ? String(call.arguments.title) : undefined,
          kind: call.arguments.kind ? String(call.arguments.kind) : undefined,
          scope,
          projectId: scope === 'project' && projectId && projectId !== '__general__' ? projectId : null,
          tags: Array.isArray(call.arguments.tags) ? call.arguments.tags.map(String) : undefined,
          pinned: call.arguments.pinned === true,
          source: 'agent'
        })
        if (!res.ok) {
          return { toolCallId: call.id, content: res.error || 'Failed to save memory', isError: true }
        }
        const m = res.memory
        return {
          toolCallId: call.id,
          content: res.deduped
            ? `Memory already known (refreshed): ${m?.id}\n${m?.title}`
            : `Saved memory ${m?.id}\n[${m?.kind}] ${m?.title}\n${m?.content}`
        }
      }

      case 'memory_list': {
        if (!api.memory?.list) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const projectId = (await import('../stores/app')).useAppStore.getState().activeProjectId
        const res = await api.memory.list({
          query: call.arguments.query != null ? String(call.arguments.query) : undefined,
          kind: call.arguments.kind ? String(call.arguments.kind) : undefined,
          scope: call.arguments.scope ? String(call.arguments.scope) : undefined,
          projectId: projectId && projectId !== '__general__' ? projectId : null,
          limit: call.arguments.limit != null ? Number(call.arguments.limit) : 30
        })
        const items = res.items || []
        if (!items.length) return { toolCallId: call.id, content: 'No memories stored yet.' }
        const lines = items.map(
          (m: { id: string; kind: string; title: string; content: string; pinned?: boolean }, i: number) =>
            `${i + 1}. [${m.kind}${m.pinned ? ', pinned' : ''}] ${m.title}\n   id: ${m.id}\n   ${m.content.slice(0, 240)}`
        )
        return {
          toolCallId: call.id,
          content: `# Memories (total≈${res.total ?? items.length})\n\n${lines.join('\n\n')}`
        }
      }

      case 'memory_forget': {
        if (!api.memory?.forget) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const id = String(call.arguments.id || '').trim()
        if (!id) return { toolCallId: call.id, content: 'id is required', isError: true }
        const res = await api.memory.forget(id)
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'Forget failed', isError: true }
        return { toolCallId: call.id, content: `Forgot memory ${id}` }
      }

      case 'memory_update': {
        if (!api.memory?.update) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const id = String(call.arguments.id || '').trim()
        if (!id) return { toolCallId: call.id, content: 'id is required', isError: true }
        const res = await api.memory.update(id, {
          content: call.arguments.content != null ? String(call.arguments.content) : undefined,
          title: call.arguments.title != null ? String(call.arguments.title) : undefined,
          kind: call.arguments.kind != null ? String(call.arguments.kind) : undefined,
          tags: Array.isArray(call.arguments.tags) ? call.arguments.tags.map(String) : undefined,
          pinned: call.arguments.pinned as boolean | undefined,
          enabled: call.arguments.enabled as boolean | undefined
        })
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'Update failed', isError: true }
        return {
          toolCallId: call.id,
          content: `Updated memory ${res.memory?.id}\n[${res.memory?.kind}] ${res.memory?.title}\n${res.memory?.content}`
        }
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
      case 'github_review_pull':
      case 'github_list_commits':
      case 'github_get_file':
      case 'github_search_code':
      case 'github_search_issues':
      case 'github_create_issue':
      case 'github_draft_issue':
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
