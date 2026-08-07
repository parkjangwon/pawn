import type { ToolDefinition } from '../toolDefinitionsTypes'

export const SHELL_TOOLS: ToolDefinition[] = [
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
        },
        sandbox: {
          type: 'boolean',
          description:
            'Apply sandbox policy (env allowlist + dangerous-command block). Default true. Set false only when the user needs full env/secrets for a trusted local tool.'
        },
        network: {
          type: 'boolean',
          description:
            'Allow network access (default true). When false on macOS, wraps with sandbox-exec network-deny when available.'
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
    name: 'terminal_list',
    description: 'List embedded terminal sessions and buffer sizes. Use before terminal_read.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'terminal_read',
    description:
      'Read recent output from an embedded terminal session (ANSI stripped). Use when the user says a command failed in the terminal panel or you need the last shell output without re-running.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Terminal id from terminal_list. If omitted, reads the first available session.'
        },
        max_chars: { type: 'number', description: 'Max characters from the end of the buffer (default 20000)' }
      }
    }
  }
]
