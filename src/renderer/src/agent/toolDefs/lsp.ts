import type { ToolDefinition } from '../toolDefinitionsTypes'

export const LSP_TOOLS: ToolDefinition[] = [
  {
    name: 'lsp_diagnostics',
    description:
      'Real compiler/type-checker errors for specific files from the language server (TypeScript/JavaScript, Python, Go, Rust). ' +
      'Much faster than a full typecheck; use after edits or to inspect a file. Edits already report their own file automatically.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files (absolute or project-relative), up to 20'
        },
        include_warnings: { type: 'boolean', description: 'Also list warnings (default false)' }
      },
      required: ['paths']
    }
  },
  {
    name: 'lsp_definition',
    description:
      'Go to definition via the language server: where the symbol at path:line:column is defined (follows imports, types, re-exports). ' +
      'More precise than grep for overloaded or common names.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File containing the symbol' },
        line: { type: 'number', description: '1-based line' },
        column: { type: 'number', description: '1-based column of any character in the symbol' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'lsp_references',
    description:
      'Find all references to the symbol at path:line:column via the language server (semantic, not text search). ' +
      'Use before renaming or changing a signature to see every call site.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File containing the symbol' },
        line: { type: 'number', description: '1-based line' },
        column: { type: 'number', description: '1-based column of any character in the symbol' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'lsp_hover',
    description: 'Type signature and docs of the symbol at path:line:column from the language server (inferred types, overloads, JSDoc/docstrings).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number', description: '1-based line' },
        column: { type: 'number', description: '1-based column' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'lsp_symbols',
    description:
      'Outline of a file (classes, functions, methods with line numbers) — or, with query, search symbols across the workspace (path = any file of that language).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        query: { type: 'string', description: 'Workspace symbol search (fuzzy name)' }
      },
      required: ['path']
    }
  },
  {
    name: 'lsp_call_hierarchy',
    description: 'Who calls the function at path:line:column (incoming) or what it calls (outgoing), semantically across files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number' },
        column: { type: 'number' },
        direction: { type: 'string', enum: ['incoming', 'outgoing'], description: 'Default incoming' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'lsp_rename',
    description:
      'Rename the symbol at path:line:column everywhere it is used (semantic, across files, including imports) and apply the edits. Safer than search-and-replace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number' },
        column: { type: 'number' },
        new_name: { type: 'string' }
      },
      required: ['path', 'line', 'column', 'new_name']
    }
  },
  {
    name: 'lsp_code_actions',
    description:
      'Quick fixes and refactorings the language server offers for a line range (add missing import, fix all, organize imports, extract function, …). Lists them; apply one with lsp_apply_code_action.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number', description: 'First line (1-based)' },
        end_line: { type: 'number', description: 'Last line (default = line)' },
        column: { type: 'number', description: 'Start column for an exact selection (extract refactorings)' },
        end_column: { type: 'number', description: 'End column (exclusive) of the selection' },
        only: { type: 'array', items: { type: 'string' }, description: 'Kinds filter, e.g. ["quickfix"], ["source.organizeImports"]' }
      },
      required: ['path', 'line']
    }
  },
  {
    name: 'lsp_apply_code_action',
    description: 'Apply a code action from the latest lsp_code_actions list for the same file (by index). Edits are recorded for undo.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        index: { type: 'number' }
      },
      required: ['path', 'index']
    }
  }
]
