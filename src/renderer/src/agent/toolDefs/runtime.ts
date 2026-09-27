import type { ToolDefinition } from '../toolDefinitionsTypes'

/** Runtime perception, context endurance, checkpoints and the repo profile. */
export const RUNTIME_TOOLS: ToolDefinition[] = [
  {
    name: 'shell_wait',
    description:
      'Wait until a background job prints a pattern, a localhost port opens, or it exits (e.g. a dev server is ready). Returns status, detected URLs/ports, errors, output tail.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Background job id' },
        until: { type: 'string', description: 'Regex, e.g. "ready|listening"' },
        port: { type: 'number', description: 'Localhost port' },
        timeout: { type: 'number', description: 'Seconds (default 60)' }
      },
      required: ['job_id']
    }
  },
  {
    name: 'read_output',
    description: 'Read a saved full tool output (id out_… shown in truncated/cleared results): page (offset/limit), grep, or tail.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        offset: { type: 'number', description: '1-based line' },
        limit: { type: 'number', description: 'Lines (default 200)' },
        grep: { type: 'string', description: 'Regex filter' },
        context: { type: 'number', description: 'Lines around grep hits (0-5)' },
        tail: { type: 'number', description: 'Last N lines' }
      },
      required: ['id']
    }
  },
  {
    name: 'working_notes',
    description:
      'Your durable scratchpad for long tasks: key facts, decisions, file locations, what is done and what is next. Notes survive context clearing and compaction (older tool results may be removed from context). ' +
      'Update them at milestones. action "view" | "set" (replace all) | "append".',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['view', 'set', 'append'] },
        content: { type: 'string', description: 'Markdown text for set / append' }
      },
      required: ['action']
    }
  },
  {
    name: 'checkpoint_mark',
    description:
      'Mark a known-good state of the files you have changed (e.g. "tests green before refactor"). Later, checkpoint_restore can put every file you touched back to this state if an approach fails.',
    parameters: {
      type: 'object',
      properties: { label: { type: 'string', description: 'Short unique label' } },
      required: ['label']
    }
  },
  {
    name: 'checkpoint_restore',
    description:
      'Restore all files you changed in this session to a checkpoint (default: the latest). Files first touched after the mark go back to their original content. The restore itself can be undone by the user. ' +
      'Pass list:true to see checkpoints.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Checkpoint label (default latest)' },
        list: { type: 'boolean', description: 'List checkpoints instead of restoring' }
      }
    }
  },
  {
    name: 'project_profile',
    description:
      'The learned profile of this repository: stack, package manager, verified build/test/lint commands, conventions, and gotchas (shown in your context each turn). ' +
      'Record what you learn so future sessions benefit: action "set_command" (kind + command), "add_note" (a gotcha/lesson), "remove_note" (index), or "view".',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['view', 'set_command', 'add_note', 'remove_note', 'refresh'] },
        kind: { type: 'string', enum: ['install', 'build', 'typecheck', 'test', 'lint', 'format', 'dev'] },
        command: { type: 'string' },
        note: { type: 'string' },
        index: { type: 'number' }
      },
      required: ['action']
    }
  }
]

/** Browser runtime perception (browser tool group). */
export const BROWSER_RUNTIME_TOOLS: ToolDefinition[] = [
  {
    name: 'browser_console',
    description:
      'Console messages, uncaught exceptions, crashes and load failures of your browser tab. Default: errors and warnings since your last check. Use after interacting with a web app to see what broke.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['error', 'warn', 'all'], description: 'Minimum level (default warn)' },
        all: { type: 'boolean', description: 'Include events you already saw (default false)' },
        clear: { type: 'boolean', description: 'Clear the tab log afterwards' }
      }
    }
  },
  {
    name: 'browser_network',
    description: 'Failed network requests (HTTP 4xx/5xx and connection errors) of your browser tab since your last check — API errors behind a broken UI.',
    parameters: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Include events you already saw (default false)' }
      }
    }
  }
]

/** Code intelligence beyond grep. */
export const CODE_INTEL_TOOLS: ToolDefinition[] = [
  {
    name: 'semantic_search',
    description:
      'Find code by what it does when you do not know its names (local hybrid index, no network), e.g. "where are failed requests retried". Pass 2-4 phrasings / likely identifiers. Exact names: grep_search.',
    parameters: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' } },
        path_prefix: { type: 'string', description: 'Directory filter, e.g. "src/main"' },
        limit: { type: 'number', description: 'Default 10' }
      },
      required: ['queries']
    }
  },
  {
    name: 'affected_tests',
    description:
      'Tests that cover the changed files (import graph for TS/JS, Python, Go + name matching) and the command to run only them. Default: files you changed this session.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Changed files (optional)' }
      }
    }
  }
]
