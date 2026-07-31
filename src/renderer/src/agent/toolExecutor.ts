import { readSkill } from './skills'
import { getBrowserAgent, type BrowserAgent } from './browser'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { checkPermission } from './toolPermission'
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

// Convert a glob pattern to a RegExp and test against a filename
export function matchesGlob(name: string, pattern: string): boolean {
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
    return new RegExp(`^${regexStr}$`, 'i').test(name)
  } catch {
    return name.toLowerCase().includes(pattern.toLowerCase())
  }
}

// Execute a tool call and return the result
export async function executeTool(call: ToolCall, projectPath?: string): Promise<ToolResult> {
  const api = window.api

  // Check permission before execution
  const permitted = await checkPermission(call.name, call.arguments)
  if (!permitted) {
    return { toolCallId: call.id, content: `Permission denied: ${call.name}`, isError: true }
  }

  try {
    switch (call.name) {
      case 'read_file': {
        const filePath = call.arguments.path as string
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
        return { toolCallId: call.id, content: result as string }
      }

      case 'write_file': {
        const wPath = call.arguments.path as string
        const newContent = call.arguments.content as string
        const existing = await api.fs.readFile(wPath)
        const result = await api.fs.writeFile(wPath, newContent)
        if ('error' in result) {
          return { toolCallId: call.id, content: result.error!, isError: true }
        }
        const filename = wPath.split('/').pop() || wPath
        if (typeof existing === 'string') {
          return {
            toolCallId: call.id,
            content: `File written: ${wPath}`,
            diffData: { oldText: existing, newText: newContent, filename }
          }
        }
        return { toolCallId: call.id, content: `File created: ${wPath}` }
      }

      case 'edit_file': {
        const path = call.arguments.path as string
        const oldStr = call.arguments.old_string as string
        const newStr = call.arguments.new_string as string
        const fileContent = await api.fs.readFile(path)
        if (typeof fileContent === 'object' && 'error' in fileContent) {
          return { toolCallId: call.id, content: fileContent.error, isError: true }
        }
        const occurrences = (fileContent as string).split(oldStr).length - 1
        if (occurrences === 0) {
          return { toolCallId: call.id, content: 'old_string not found in file', isError: true }
        }
        if (occurrences > 1) {
          return {
            toolCallId: call.id,
            content: `old_string appears ${occurrences} times in file. Provide more surrounding context to make it unique.`,
            isError: true
          }
        }
        const updated = (fileContent as string).replace(oldStr, newStr)
        const writeResult = await api.fs.writeFile(path, updated)
        if ('error' in writeResult) {
          return { toolCallId: call.id, content: writeResult.error!, isError: true }
        }
                const filename = path.split('/').pop() || path
        return {
          toolCallId: call.id,
          content: `File edited: ${path}`,
          diffData: { oldText: oldStr, newText: newStr, filename }
        }
      }

      case 'list_dir': {
        const result = await api.fs.listDir(call.arguments.path as string)
        if (Array.isArray(result)) {
          const listing = result.map((e) => `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
          return { toolCallId: call.id, content: listing || '(empty)' }
        }
        return { toolCallId: call.id, content: (result as { error: string }).error, isError: true }
      }

      case 'shell_exec': {
        const result = await api.shell.exec(
          call.arguments.command as string,
          (call.arguments.cwd as string) || projectPath
        )
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
        return {
          toolCallId: call.id,
          content: output || `(exit code: ${result.exitCode})`,
          isError: result.exitCode !== 0
        }
      }

      case 'computer_screenshot': {
        const result = await api.computer.screenshot()
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: `[Screenshot captured: ${result.dataUrl?.slice(0, 50)}...]` }
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
        return { toolCallId: call.id, content: `[Screenshot captured, ${res.bytes} bytes of PNG data]` }
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

      case 'search_files': {
        const pattern = call.arguments.pattern as string
        const rootPath = (call.arguments.rootPath as string) || projectPath || ''
        if (!rootPath) return { toolCallId: call.id, content: 'No project path set', isError: true }
        const walkResult = await window.api.fs.walk(rootPath)
        if (!Array.isArray(walkResult)) {
          return { toolCallId: call.id, content: (walkResult as { error: string }).error, isError: true }
        }
        // Match against the path relative to the search root so **/*.ts and
        // src/**/*.css work as expected.
        const root = rootPath.endsWith('/') ? rootPath : rootPath + '/'
        const files = walkResult.filter((f) => {
          if (f.isDirectory) return false
          const rel = f.path.startsWith(root) ? f.path.slice(root.length) : f.name
          return matchesGlob(rel, pattern)
        })
        if (files.length === 0) return { toolCallId: call.id, content: 'No files found matching: ' + pattern }
        return { toolCallId: call.id, content: `Found ${files.length} files:\n${files.slice(0, 50).map((f) => f.path).join('\n')}` }
      }

      case 'grep_search': {
        const query = call.arguments.query as string
        const filePattern = (call.arguments.pattern as string) || ''
        const grepRoot = (call.arguments.rootPath as string) || projectPath || ''
        if (!grepRoot) return { toolCallId: call.id, content: 'No project path set', isError: true }
        const walkResult2 = await window.api.fs.walk(grepRoot)
        if (!Array.isArray(walkResult2)) {
          return { toolCallId: call.id, content: (walkResult2 as { error: string }).error, isError: true }
        }
        const grepRoot2 = (grepRoot.endsWith('/') ? grepRoot : grepRoot + '/')
        const candidates = filePattern
          ? walkResult2.filter((f) => {
              if (f.isDirectory) return false
              const rel = f.path.startsWith(grepRoot2) ? f.path.slice(grepRoot2.length) : f.name
              return matchesGlob(rel, filePattern)
            })
          : walkResult2.filter((f) => !f.isDirectory)
        let regex: RegExp
        try {
          regex = new RegExp(query, 'g')
        } catch {
          return { toolCallId: call.id, content: 'Invalid regex pattern: ' + query, isError: true }
        }
        const matches: string[] = []
        for (const file of candidates.slice(0, 200)) {
          if (matches.length >= 50) break
          const content = await window.api.fs.readFile(file.path)
          if (typeof content !== 'string') continue
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0
            if (regex.test(lines[i])) {
              matches.push(`${file.path}:${i + 1}: ${lines[i].trim()}`)
              if (matches.length >= 50) break
            }
          }
        }
        if (matches.length === 0) return { toolCallId: call.id, content: 'No matches found for: ' + query }
        return { toolCallId: call.id, content: matches.join('\n').slice(0, 3000) }
      }

      case 'app_open_tab': {
        const tab = String(call.arguments.tab || '')
        const valid = ['terminal', 'files', 'git', 'browser', 'diff']
        if (!valid.includes(tab)) {
          return { toolCallId: call.id, content: `Unknown tab "${tab}". Valid tabs: ${valid.join(', ')}`, isError: true }
        }
        try { (window as any).__openRightPanelTab?.(tab) } catch {}
        return { toolCallId: call.id, content: `Opened right panel on tab: ${tab}` }
      }

      case 'app_close_tab': {
        const tab = String(call.arguments.tab || '')
        const valid = ['terminal', 'files', 'git', 'browser', 'diff']
        if (!valid.includes(tab)) {
          return { toolCallId: call.id, content: `Unknown tab "${tab}". Valid tabs: ${valid.join(', ')}`, isError: true }
        }
        try { (window as any).__closeRightPanelTab?.(tab) } catch {}
        return { toolCallId: call.id, content: `Closed tab: ${tab}` }
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

      default:
        return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true }
    }
  } catch (err) {
    return { toolCallId: call.id, content: String(err), isError: true }
  }
}
