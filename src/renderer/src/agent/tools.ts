import type { ApiFormat } from '../types/provider'

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
  }
]

// Execute a tool call and return the result
export async function executeTool(call: ToolCall, projectPath?: string): Promise<ToolResult> {
  const api = window.api
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
        const result = await api.fs.writeFile(
          call.arguments.path as string,
          call.arguments.content as string
        )
        if ('error' in result) {
          return { toolCallId: call.id, content: result.error!, isError: true }
        }
        return { toolCallId: call.id, content: `File written: ${call.arguments.path}` }
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
        return { toolCallId: call.id, content: `File edited: ${path}` }
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
        await api.browser.open(call.arguments.url as string)
        return { toolCallId: call.id, content: `Opened: ${call.arguments.url}` }
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
