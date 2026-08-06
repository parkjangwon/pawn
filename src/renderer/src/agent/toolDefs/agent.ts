import type { ToolDefinition } from '../toolDefinitionsTypes'

export const AGENT_TOOLS: ToolDefinition[] = [
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
    name: 'run_checks',
    description:
      'Detect and run project quality checks (typecheck/test/lint) from package.json scripts, go.mod, Cargo.toml, or pytest. Prefer this after edits instead of guessing shell commands. kind=all runs typecheck then test then lint and stops on first failure.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'all | typecheck | test | lint | build (default all)'
        },
        timeout: {
          type: 'number',
          description: 'Timeout seconds per command (default 120, max 600)'
        },
        cwd: { type: 'string', description: 'Project root (optional)' }
      }
    }
  },
  {
    name: 'repo_map',
    description:
      'Build a compact local map of the repository (paths + key symbols). Prefer this once at the start of large tasks before blind grepping. Faster than reading every file; not a substitute for read_file before edits.',
    parameters: {
      type: 'object',
      properties: {
        max_files: { type: 'number', description: 'Max source files to include (default 80, max 200)' },
        rootPath: { type: 'string', description: 'Project root (optional)' }
      }
    }
  },
  {
    name: 'issue_to_pr',
    description:
      'Start the Issue→PR playbook for a GitHub/GitLab issue number or URL. Returns a structured workflow the agent must follow with existing tools (fetch issue, edit, run_checks, git_pr_ready, optional create PR). Prefer when the user asks to fix an issue and open a PR.',
    parameters: {
      type: 'object',
      properties: {
        issue: {
          type: 'string',
          description: 'Issue number (#42), owner/repo#42, or full issue URL'
        },
        repo: { type: 'string', description: 'Optional owner/repo hint when only a number is given' }
      },
      required: ['issue']
    }
  },
  {
    name: 'codebase_search',
    description:
      'Symbol-aware local search: finds likely definitions (function/class/type/const/…) and references for a name or phrase under the project. Prefer this to locate symbols before grep_search; use grep_search for arbitrary regex/text.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol or phrase to find' },
        path_glob: {
          type: 'string',
          description: 'Optional glob to limit files (e.g. "src/**/*.ts")'
        },
        max_results: { type: 'number', description: 'Max hits (default 40)' },
        rootPath: { type: 'string', description: 'Root to search (optional)' }
      },
      required: ['query']
    }
  },
  {
    name: 'write_artifact',
    description:
      'Write a file under <project>/artifacts/ (reports, notes, exports). Creates the directory if needed. Prefer this for durable agent outputs the user can browse later.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Relative path under artifacts/, e.g. "notes/summary.md" or "report.md"'
        },
        content: { type: 'string', description: 'File contents' }
      },
      required: ['name', 'content']
    }
  },
  {
    name: 'list_artifacts',
    description: 'List files in <project>/artifacts/ (optional subdir).',
    parameters: {
      type: 'object',
      properties: {
        subdir: { type: 'string', description: 'Optional subdirectory under artifacts/' }
      }
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
  }
]
