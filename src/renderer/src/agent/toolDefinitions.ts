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
  diffData?: { oldText: string; newText: string; filename: string; path?: string }
}

// Tool definitions sent to LLM
export const TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read a file. Paths may be absolute or relative to the project working directory. For large files, pass offset/limit (1-based line numbers) to page through content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute or project-relative)' },
        offset: { type: 'number', description: '1-based start line (optional)' },
        limit: { type: 'number', description: 'Max lines to return (optional, default 500 when paging)' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist. Paths may be absolute or project-relative.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute or project-relative)' },
        content: { type: 'string', description: 'File content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description:
      'Edit a file by replacing old_string with new_string. old_string must match exactly once unless replace_all is true. Include enough surrounding context for a unique match.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute or project-relative)' },
        old_string: { type: 'string', description: 'Exact text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace every occurrence. Default false (requires a unique match).'
        }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_dir',
    description: 'List files and directories in a path (non-recursive). Paths may be absolute or project-relative.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (absolute or project-relative). Defaults to project root when omitted.'
        }
      },
      required: []
    }
  },
  {
    name: 'delete_file',
    description:
      'Delete a single file or an empty directory. Prefer this over shell rm for simple deletes. Non-empty directories are refused — clear contents first or use shell_exec carefully for recursive removal.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or empty directory path (absolute or project-relative)' }
      },
      required: ['path']
    }
  },
  {
    name: 'shell_exec',
    description:
      'Execute a shell command and return stdout/stderr. Prefer specialized tools (read_file, edit_file, grep_search, search_files, git_status, git_diff) when available. Avoid interactive TUI commands. Set background:true for long jobs (tests/builds); then use shell_poll / shell_kill.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional, defaults to project root)' },
        timeout: { type: 'number', description: 'Timeout in seconds (5-300, default 30). Ignored when background is true.' },
        background: {
          type: 'boolean',
          description: 'If true, start the command in the background and return a job id immediately.'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'shell_poll',
    description: 'Poll a background shell job started with shell_exec(background:true). Returns status, stdout, stderr.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id returned by shell_exec background start' }
      },
      required: ['job_id']
    }
  },
  {
    name: 'shell_kill',
    description: 'Kill a background shell job by id.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id to kill' }
      },
      required: ['job_id']
    }
  },
  {
    name: 'update_plan',
    description:
      'Create or replace the session task plan checklist shown to the user. Call at the start of multi-step work and update statuses as you progress.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Plan items in order',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable id (optional)' },
              content: { type: 'string', description: 'Short step description' },
              status: {
                type: 'string',
                description: 'pending | in_progress | done | cancelled'
              }
            },
            required: ['content']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'git_log',
    description: 'Show recent git commits (oneline). Prefer this over shell_exec for history.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of commits (default 15, max 50)' },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      }
    }
  },
  {
    name: 'git_status',
    description:
      'Show git status --short and current branch for the project. Prefer this over shell_exec for reviewing workspace changes.',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repo root (optional, defaults to project path)' }
      }
    }
  },
  {
    name: 'git_diff',
    description:
      'Show git diff. Default is working tree vs HEAD (staged + unstaged). Set staged:true for index-only (--cached). Use path to scope to a file or directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional path to limit the diff' },
        staged: {
          type: 'boolean',
          description: 'If true, only staged changes (git diff --cached). Default false (git diff HEAD).'
        },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      }
    }
  },
  {
    name: 'computer_screenshot',
    description: 'Take a screenshot of the current screen. Image is attached for vision models.',
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
    name: 'computer_keypress',
    description: 'Press a key or combination (e.g. Return, Escape, ctrl+c, alt+Tab).',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Key name or combination' } },
      required: ['key']
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
    name: 'install_skill',
    description:
      'Install a skill or plugin from a git repository URL into standard locations: ' +
      'user skills go to ~/.agents/skills/, project skills to <project>/.claude/skills/, ' +
      'and Claude plugins to ~/.claude/plugins/ (installed_plugins.json updated). ' +
      'Detects .claude-plugin/plugin.json, skills/, .claude/skills/ and root SKILL.md layouts automatically, ' +
      'and refreshes the skill cache. Use when the user asks to install a skill or plugin from a GitHub URL.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Git repository URL (https://...) to install' },
        scope: {
          type: 'string',
          enum: ['user', 'project'],
          description: '"user" (default) installs globally via the standard user directories; "project" installs into the active project'
        }
      },
      required: ['repo']
    }
  },
  {
    name: 'search_files',
    description:
      'Find files by glob pattern under the project (e.g. **/*.tsx, src/**/*Util*.ts). Prefer this over shell find/ls.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. *.tsx, **/*util*, src/**/*.css)' },
        rootPath: { type: 'string', description: 'Root directory (optional, defaults to project root)' },
        max_results: { type: 'number', description: 'Max paths to return (default 80, max 300)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep_search',
    description:
      'Search file contents with a regex (or fixed string). Returns path:line:text. Prefer this over shell grep for code search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex pattern to search for' },
        pattern: { type: 'string', description: 'Glob file filter (e.g. *.tsx, *.{ts,tsx}), optional' },
        rootPath: { type: 'string', description: 'Root directory to search (optional)' },
        case_insensitive: { type: 'boolean', description: 'Case-insensitive match (default false)' },
        fixed_string: {
          type: 'boolean',
          description: 'Treat query as literal text, not regex (default false)'
        },
        context_lines: {
          type: 'number',
          description: 'Lines of context before/after each match (0-3, default 0)'
        },
        max_matches: { type: 'number', description: 'Max matches to return (default 80, max 200)' }
      },
      required: ['query']
    }
  },
  {
    name: 'app_open_tab',
    description: 'Open an app tool surface: terminal (bottom panel), or files/git/browser/diff (right panel). Use this to show the user what you are doing.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string', enum: ['terminal', 'files', 'git', 'browser', 'diff'], description: 'Which app tool to open (terminal is the bottom panel; others open in the right panel)' } },
      required: ['tab']
    }
  },
  {
    name: 'app_close_tab',
    description: 'Close an app tool surface: terminal (bottom panel), or files/git/browser/diff (right panel). Closing the browser also discards its current page.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string', enum: ['terminal', 'files', 'git', 'browser', 'diff'], description: 'Which app tool to close' } },
      required: ['tab']
    }
  },
  {
    name: 'app_list_automations',
    description: 'List configured automations (routines) in the app so you can review names, schedules, enabled status, and ids before changing them.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'app_create_automation',
    description: 'Create a new automation (routine) in the app without writing SQL. Use this when users ask to set up recurring work.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Automation name shown in the UI' },
        prompt: { type: 'string', description: 'Prompt the agent will run when this automation fires' },
        scheduleType: { type: 'string', enum: ['manual', 'interval', 'daily', 'weekly'], description: 'When the automation should run' },
        intervalMinutes: { type: 'number', description: 'For scheduleType=interval. Minutes between runs (>=1)' },
        hour: { type: 'number', description: 'For daily/weekly schedules. 0-23' },
        minute: { type: 'number', description: 'For daily/weekly schedules. 0-59' },
        weekday: { type: 'number', description: 'For weekly schedule. 0=Sun..6=Sat' },
        projectId: { type: 'string', description: 'Optional target project id. Empty means general/no project.' },
        sessionId: { type: 'string', description: 'Optional existing session id to bind.' },
        enabled: { type: 'boolean', description: 'Optional. Defaults to true unless scheduleType is manual.' }
      },
      required: ['name', 'prompt', 'scheduleType']
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
