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
  },
  {
    name: 'app_open_tab',
    description: 'Open the right panel on one of the app tool tabs: terminal, files, git, browser, diff. Use this to show the user what you are doing.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string', enum: ['terminal', 'files', 'git', 'browser', 'diff'], description: 'Which app tool tab to open' } },
      required: ['tab']
    }
  },
  {
    name: 'app_close_tab',
    description: 'Close an app tool tab in the right panel: terminal, files, git, browser, diff. Closing the browser also discards its current page.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string', enum: ['terminal', 'files', 'git', 'browser', 'diff'], description: 'Which app tool tab to close' } },
      required: ['tab']
    }
  },
  {
    name: 'app_set_model',
    description: 'Change the active model used for replies. Pass "auto" to let the router pick the best model, or a model id/label from the configured models. Takes effect from the next request.',
    parameters: {
      type: 'object',
      properties: { model: { type: 'string', description: '"auto" or a configured model id/label' } },
      required: ['model']
    }
  },
  {
    name: 'app_set_permission_mode',
    description: 'Change how tool permissions are handled: ask (confirm each risky action), auto (auto-approve safe actions), yolo (approve everything without asking).',
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['ask', 'auto', 'yolo'], description: 'Permission mode' } },
      required: ['mode']
    }
  },
  {
    name: 'app_set_reasoning',
    description: 'Set the reasoning effort for reasoning-capable models: auto, low, medium or high.',
    parameters: {
      type: 'object',
      properties: { effort: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: 'Reasoning effort' } },
      required: ['effort']
    }
  },
  {
    name: 'app_toggle_theme',
    description: 'Switch the app between light and dark theme.',
    parameters: { type: 'object', properties: {} }
  }
]


