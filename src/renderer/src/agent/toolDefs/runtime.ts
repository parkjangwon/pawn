import type { ToolDefinition } from '../toolDefinitionsTypes'

/** Runtime perception, context endurance, checkpoints and the repo profile. */
export const RUNTIME_TOOLS: ToolDefinition[] = [
  {
    name: 'shell_wait',
    description:
      'Wait for a background job (shell_exec background:true) until its output matches a pattern, a localhost port accepts connections, or it exits — e.g. start a dev server, then wait for "ready" or port 5173. ' +
      'Returns status, detected URLs/ports, error lines and the output tail. Much better than sleeping and polling.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Background job id' },
        until: { type: 'string', description: 'Regex to wait for in stdout/stderr (case-insensitive), e.g. "ready|listening"' },
        port: { type: 'number', description: 'Wait until this localhost port accepts TCP connections' },
        timeout: { type: 'number', description: 'Seconds to wait (default 60, max 600)' }
      },
      required: ['job_id']
    }
  },
  {
    name: 'read_output',
    description:
      'Read a full tool output that was too long for the context (truncated or cleared results mention its id, e.g. out_1a2b3c4d). Page with offset/limit, search with grep, or take the tail.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Output id (out_…)' },
        offset: { type: 'number', description: '1-based first line (default 1)' },
        limit: { type: 'number', description: 'Lines to return (default 200, max 2000)' },
        grep: { type: 'string', description: 'Regex filter; returns matching lines with line numbers' },
        context: { type: 'number', description: 'Lines of context around grep matches (0-5)' },
        tail: { type: 'number', description: 'Return the last N lines instead' }
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
      'Concept search over the whole codebase (local hybrid index: BM25 over code-aware tokens + dense vectors; no network). Finds code by what it does when you do not know the names, e.g. "where are failed requests retried with backoff". ' +
      'Pass 2-4 phrasings (synonyms, likely identifiers) in queries for best recall. Use grep_search / codebase_search for exact names.',
    parameters: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'One or more phrasings of the same question' },
        path_prefix: { type: 'string', description: 'Restrict to a directory (relative), e.g. "src/main"' },
        limit: { type: 'number', description: 'Max hits (default 10)' }
      },
      required: ['queries']
    }
  },
  {
    name: 'affected_tests',
    description:
      'Tests affected by changed files, via the import graph (TS/JS incl. path aliases, Python, Go) plus name matching, with the exact command to run just those tests. ' +
      'Default: the files you changed in this session. Run the suggested command instead of the whole suite for fast feedback, then the full suite before finishing.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Changed files (default: files changed this session, else git diff)' }
      }
    }
  }
]
