import type { ToolDefinition } from '../toolDefinitionsTypes'

export const GIT_TOOLS: ToolDefinition[] = [
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
    name: 'git_pr_ready',
    description:
      'Local "ready for PR" pack: branch, status, commits vs base, diff stat, remote GitHub repo guess, and a checklist. Prefer this before github_create_pull. Does not open a PR.',
    parameters: {
      type: 'object',
      properties: {
        base: {
          type: 'string',
          description: 'Base branch to compare against (default: origin default or main)'
        },
        cwd: { type: 'string', description: 'Repo root (optional)' }
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
  }
]
