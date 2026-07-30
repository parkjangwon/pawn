import { usePermissionStore, type PermissionType } from '../stores/permission'
import { useProviderStore } from '../stores/provider'
import { readSkill } from './skills'
import { getBrowserAgent, type BrowserAgent } from './browser'

// Safety levels for permission system
export type SafetyLevel = 'safe' | 'risky'

export const TOOL_SAFETY: Record<string, SafetyLevel> = {
  read_file: 'safe',
  list_dir: 'safe',
  load_skill: 'safe',
  search_files: 'safe',
  grep_search: 'safe',
  browser_navigate: 'safe',
  browser_snapshot: 'safe',
  browser_read_text: 'safe',
  browser_screenshot: 'safe',
  browser_back: 'safe',
  browser_open_external: 'risky',
  browser_click: 'risky',
  browser_fill: 'risky',
  browser_eval: 'risky',
  write_file: 'risky',
  edit_file: 'risky',
  shell_exec: 'risky',
  computer_screenshot: 'risky',
  computer_click: 'risky',
  computer_type: 'risky',
  computer_keypress: 'risky'
}

// Permission mode
export type PermissionMode = 'ask' | 'auto' | 'yolo'


export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
  diffData?: { oldText: string; newText: string; filename: string }
}

// Tool definitions sent to LLM
export const TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute file path' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'File content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing old_string with new_string.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        old_string: { type: 'string', description: 'Text to find and replace' },
        new_string: { type: 'string', description: 'Replacement text' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_dir',
    description: 'List files and directories in a given path.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path' } },
      required: ['path']
    }
  },
  {
    name: 'shell_exec',
    description: 'Execute a shell command and return stdout/stderr.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' }
      },
      required: ['command']
    }
  },
  {
    name: 'computer_screenshot',
    description: 'Take a screenshot of the current screen.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'computer_click',
    description: 'Click at the given screen coordinates.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_type',
    description: 'Type text using the keyboard.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type' } },
      required: ['text']
    }
  },
  {
    name: 'browser_navigate',
    description: 'Load a URL in the embedded browser and wait for it to finish loading. Returns the final URL and page title. Follow with browser_snapshot to see what is on the page.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to load. A bare domain is upgraded to https://.' } },
      required: ['url']
    }
  },
  {
    name: 'browser_snapshot',
    description: 'List the interactive elements of the current page (links, buttons, inputs, selects) with a stable "ref" for each. Use the ref with browser_click and browser_fill. Take a fresh snapshot after any navigation or click that changes the page.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional case-insensitive substring to match against element text, label, name or placeholder.' }
      }
    }
  },
  {
    name: 'browser_click',
    description: 'Click an element on the current page.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A ref from browser_snapshot, e.g. "e12".' },
        selector: { type: 'string', description: 'CSS selector, used when no ref is given.' }
      }
    }
  },
  {
    name: 'browser_fill',
    description: 'Type a value into an input, textarea or contenteditable element, firing the input and change events the page listens for.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A ref from browser_snapshot.' },
        selector: { type: 'string', description: 'CSS selector, used when no ref is given.' },
        value: { type: 'string', description: 'Text to enter.' },
        submit: { type: 'boolean', description: 'Press Enter afterwards to submit the form.' }
      },
      required: ['value']
    }
  },
  {
    name: 'browser_read_text',
    description: 'Read the visible text of the current page, or of one element.',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'Optional CSS selector to scope the read.' } }
    }
  },
  {
    name: 'browser_eval',
    description: 'Evaluate a JavaScript expression in the current page and return its result as JSON. Use for anything the other browser tools do not cover.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JS expression to evaluate.' } },
      required: ['code']
    }
  },
  {
    name: 'browser_back',
    description: 'Go back one entry in the embedded browser history.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'browser_screenshot',
    description: 'Capture the embedded browser viewport. Use when the page layout matters or the text tools are not enough.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'browser_open_external',
    description: 'Open a URL in the user default system browser instead of the embedded one.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to open' } },
      required: ['url']
    }
  },
  {
    name: 'load_skill',
    description: 'Read the full instructions of a project skill listed in "Available Skills". Call this before following a skill.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name exactly as listed.' } },
      required: ['name']
    }
  },
  {
    name: 'search_files',
    description: 'Search for files in the project by name pattern. Uses glob-style matching. For example: *.tsx, *util*, **/*.css',
    parameters: {
      type: 'object',
      properties: { 
        pattern: { type: 'string', description: 'File name pattern to search for (e.g. *.tsx, *util*, *.css)' },
        rootPath: { type: 'string', description: 'Root directory to search in (optional, defaults to project root)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep_search',
    description: 'Search for text content across all project files. Useful for finding where a function is defined, where a string is used, etc.',
    parameters: {
      type: 'object',
      properties: { 
        query: { type: 'string', description: 'Text or regex pattern to search for' },
        pattern: { type: 'string', description: 'File pattern to filter (e.g. *.tsx, *.ts), optional' },
        rootPath: { type: 'string', description: 'Root directory to search in (optional)' }
      },
      required: ['query']
    }
  }
]



async function checkPermission(
  callName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const mode = useProviderStore.getState().permissionMode
  if (mode === 'yolo') return true
  
  const safety = TOOL_SAFETY[callName] || 'risky'
  if (mode === 'auto' && safety === 'safe') return true

  const typeLabels: Record<string, string> = {
    read_file: 'Read File',
    write_file: 'Write File',
    edit_file: 'Edit File',
    list_dir: 'List Directory',
    shell_exec: 'Shell Command',
    computer_screenshot: 'Take Screenshot',
    computer_click: 'Mouse Click',
    computer_type: 'Type Text',
    browser_click: 'Click in Browser',
    browser_fill: 'Type in Browser',
    browser_eval: 'Evaluate JS in Page',
    browser_open_external: 'Open External Browser'
  }

  const approved = await usePermissionStore.getState().request({
    type: (() => {
      const map: Record<string, string> = {
        computer_screenshot: 'computer_use', computer_click: 'computer_use', computer_type: 'computer_use', computer_keypress: 'computer_use',
        browser_eval: 'browser', browser_click: 'browser', browser_fill: 'browser', browser_open_external: 'browser',
        shell_exec: 'shell_exec',
        write_file: 'file_write', edit_file: 'file_write'
      }
      return map[callName] || 'file_read'
    })() as PermissionType,
    description: typeLabels[callName] || callName,
    details: JSON.stringify(args, null, 2).slice(0, 500)
  })
  return approved
}

/**
 * Resolve the browser bridge, creating the embedded page if the panel was never
 * opened. The agent should be able to drive the browser headlessly; requiring the
 * user to open a panel first made every browser tool fail on the first call.
 */
async function requireBrowser(): Promise<{ agent: BrowserAgent } | { error: string }> {
  const agent = getBrowserAgent()
  if (!agent) {
    return { error: 'The embedded browser is only available in the desktop app.' }
  }
  const ready = await agent.ensure()
  if (ready.error) return { error: ready.error }
  return { agent }
}

// Convert a glob pattern to a RegExp and test against a filename
function matchesGlob(name: string, pattern: string): boolean {
  // Escape all special regex chars except * and ?
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
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
        if (!projectPath) return { toolCallId: call.id, content: 'No project path set; skills come from the project directory.', isError: true }
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
        const files = walkResult.filter((f) => !f.isDirectory && matchesGlob(f.name, pattern))
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
        const candidates = filePattern
          ? walkResult2.filter((f) => !f.isDirectory && matchesGlob(f.name, filePattern))
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

      default:
        return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true }
    }
  } catch (err) {
    return { toolCallId: call.id, content: String(err), isError: true }
  }
}

// Convert tools to OpenAI format
export function toolsToOpenAI(): Array<Record<string, unknown>> {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

// Convert tools to Claude format
export function toolsToClaude(): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }))
  // Tool schemas never change, so cache the whole definitions block. This is one
  // of the largest stable prefixes and a big cache-hit win on every turn.
  if (tools.length > 0) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } }
  }
  return tools
}
