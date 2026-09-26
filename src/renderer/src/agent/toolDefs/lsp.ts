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
  }
]
