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
  },
  {
    name: 'git_add',
    description:
      'Stage files for commit (git add). Prefer this over shell_exec. Pass paths array, or all:true to stage everything (git add -A). Review with git_status/git_diff(staged:true) before git_commit.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to stage (relative to repo root)'
        },
        all: {
          type: 'boolean',
          description: 'If true, stage all changes (git add -A). Default false.'
        },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      }
    }
  },
  {
    name: 'git_commit',
    description:
      'Create a git commit from the staged index. Requires a real commit message (not "wip"/"fix"). Prefer after git_add + git_diff(staged:true). Does not push.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message (required)' },
        allow_empty: {
          type: 'boolean',
          description: 'Allow empty commit (default false)'
        },
        no_verify: {
          type: 'boolean',
          description: 'Skip hooks with --no-verify (default false; only if user asks)'
        },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      },
      required: ['message']
    }
  },
  {
    name: 'git_push',
    description:
      'Push the current branch to remote (default origin). Sets upstream on first push. Force push is intentionally blocked — ask the user and use shell only if they insist. Prefer after checks are green.',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name (default origin)' },
        branch: { type: 'string', description: 'Branch to push (default current)' },
        set_upstream: {
          type: 'boolean',
          description: 'Set upstream if missing (default true)'
        },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      }
    }
  },
  {
    name: 'git_branch',
    description:
      'List, create, checkout, or delete a local branch. create:true runs checkout -b. Prefer this over shell_exec for branch ops.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name (omit with list:true)' },
        create: { type: 'boolean', description: 'Create and checkout (-b)' },
        delete: { type: 'boolean', description: 'Delete local branch (-d)' },
        list: { type: 'boolean', description: 'List branches (default when no name)' },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      }
    }
  },
  {
    name: 'git_stash',
    description:
      'Stash working tree changes. action: push (default) | pop | list | drop. Prefer over shell_exec.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'push | pop | list | drop (default push)'
        },
        message: { type: 'string', description: 'Optional stash message (push)' },
        cwd: { type: 'string', description: 'Repo root (optional)' }
      }
    }
  }
]
