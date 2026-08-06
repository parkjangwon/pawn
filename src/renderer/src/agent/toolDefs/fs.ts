import type { ToolDefinition } from '../toolDefinitionsTypes'

export const FS_TOOLS: ToolDefinition[] = [
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
    name: 'read_spreadsheet',
    description:
      'Read a CSV/TSV/XLSX spreadsheet with hard row/column caps (safe for large files). Returns a markdown table preview plus sheet names. Prefer this over read_file for .csv/.xlsx.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Spreadsheet path (absolute or project-relative)' },
        sheet: { type: 'string', description: 'Worksheet name (xlsx only; default first sheet)' },
        max_rows: { type: 'number', description: 'Max rows to return (default 80, max 200)' },
        max_cols: { type: 'number', description: 'Max columns to return (default 24, max 50)' }
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
  }
]
