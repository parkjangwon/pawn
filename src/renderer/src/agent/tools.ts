import type { ApiFormat } from '../types/provider'
import { usePermissionStore } from '../stores/permission'
import { useProviderStore } from '../stores/provider'

// Safety levels for permission system
export type SafetyLevel = 'safe' | 'risky'

export const TOOL_SAFETY: Record<string, SafetyLevel> = {
  read_file: 'safe',
  list_dir: 'safe',
  browser_open: 'safe',
  browser_eval: 'risky',
  browser_read: 'safe',
  search_files: 'safe',
  grep_search: 'safe',
  write_file: 'risky',
  edit_file: 'risky',
  shell_exec: 'risky',
  computer_screenshot: 'risky',
  computer_click: 'risky',
  computer_type: 'risky'
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
    name: 'browser_open',
    description: 'Open a URL in the browser.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to open' } },
      required: ['url']
    }
  },
  {
    name: 'browser_eval',
    description: 'Execute JavaScript code in the current browser page. Returns the result of the expression. Use to inspect/manipulate DOM, click, fill forms.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JS code to evaluate' } },
      required: ['code']
    }
  },
  {
    name: 'browser_read',
    description: 'Read the current browser state: URL, console logs.',
    parameters: { type: 'object', properties: {} }
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
    browser_open: 'Open Browser',
    browser_eval: 'Evaluate JS',
    browser_read: 'Read Page'
  }

  const approved = await usePermissionStore.getState().request({
    type: callName.startsWith('computer_') ? 'computer_use' : callName.startsWith('browser_') ? 'browser' : callName === 'shell_exec' ? 'shell_exec' : 'file_write',
    description: typeLabels[callName] || callName,
    details: JSON.stringify(args, null, 2).slice(0, 500)
  })
  return approved
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
        const result = await api.fs.readFile(call.arguments.path as string)
        if (typeof result === 'object' && 'error' in result) {
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
        if (!(fileContent as string).includes(oldStr)) {
          return { toolCallId: call.id, content: 'old_string not found in file', isError: true }
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

      case 'browser_open': {
        const url = call.arguments.url as string
        // Try internal browser first
        const pawb = (window as any).__pawnBrowser
        if (pawb) {
          pawb.navigate(url)
          return { toolCallId: call.id, content: `Navigated to: ${url}` }
        }
        await api.browser.open(url)
        return { toolCallId: call.id, content: `Opened externally: ${url}` }
      }

      case 'browser_eval': {
        const pawb = (window as any).__pawnBrowser
        if (!pawb) return { toolCallId: call.id, content: 'Browser not active. Open the Browser panel first.', isError: true }
        try {
          const result = await pawb.evaluate(call.arguments.code as string)
          return { toolCallId: call.id, content: JSON.stringify(result, null, 2) }
        } catch (err) {
          return { toolCallId: call.id, content: 'Eval error: ' + String(err), isError: true }
        }
      }

      case 'browser_read': {
        const pawb2 = (window as any).__pawnBrowser
        if (!pawb2) return { toolCallId: call.id, content: 'Browser not active. Open the Browser panel first.', isError: true }
        const url = pawb2.getUrl()
        const logs = pawb2.getLogs()
        return { toolCallId: call.id, content: `URL: ${url || '(none)'}\nConsole logs:\n${logs.slice(-20).join('\n')}` }
      }

      case 'search_files': {
        const pattern = call.arguments.pattern as string
        const rootPath = (call.arguments.rootPath as string) || projectPath || ''
        if (!rootPath) return { toolCallId: call.id, content: 'No project path set', isError: true }
        // Use shell find command for pattern matching
        const searchCmd = pattern.includes('*') 
          ? `find "${rootPath}" -type f -name "${pattern}" 2>/dev/null | head -50`
          : `find "${rootPath}" -type f -name "*${pattern}*" 2>/dev/null | head -50`
        const result = await window.api.shell.exec(searchCmd)
        const files = result.stdout.trim().split('\n').filter(Boolean)
        if (files.length === 0) return { toolCallId: call.id, content: 'No files found matching: ' + pattern }
        return { toolCallId: call.id, content: `Found ${files.length} files:\n${files.join('\n')}` }
      }

      case 'grep_search': {
        const query = call.arguments.query as string
        const gPattern = (call.arguments.pattern as string) || '*'
        const grepRoot = (call.arguments.rootPath as string) || projectPath || ''
        if (!grepRoot) return { toolCallId: call.id, content: 'No project path set', isError: true }
        // Use grep for text search
        const grepCmd = `grep -rn --include="${gPattern}" "${query}" "${grepRoot}" 2>/dev/null | head -50`
        const gResult = await window.api.shell.exec(grepCmd)
        const gFiles = gResult.stdout.trim().split('\n').filter(Boolean)
        if (gFiles.length === 0) return { toolCallId: call.id, content: 'No matches found for: ' + query }
        return { toolCallId: call.id, content: gFiles.join('\n').slice(0, 2000) }
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
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }))
}
