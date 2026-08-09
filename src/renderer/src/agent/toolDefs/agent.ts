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
        max_files: { type: 'number', description: 'Max source files to include (default 120, max 300)' },
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
  },
  {
    name: 'spawn_agent',
    description:
      'Delegate a focused sub-task to a specialized nested agent with its own context and tool loop. ' +
      'Built-ins: explore (read-only search), plan (read-only planning research), ' +
      'worker (implement + verify; worktree + auto-apply), code-reviewer (read-only review). ' +
      'Custom: .pawn/agents/ or .claude/agents/. Call list_agents for custom names. ' +
      'For 2+ independent tasks use parallel_agents (true concurrency). ' +
      'background=true returns a run id immediately (Agents panel + await_agent). ' +
      'Returns a compact summary; worker apply reports files + overwrite conflicts.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Full task instructions for the subagent (be specific about goals and constraints)'
        },
        name: { type: 'string', description: 'Short label for this run (optional)' },
        agent: {
          type: 'string',
          description:
            'Profile name: explore | plan | worker | code-reviewer | custom agent from .pawn/agents (default explore)'
        },
        mode: {
          type: 'string',
          description: 'Legacy alias: explore | worker (prefer `agent`)'
        },
        thoroughness: {
          type: 'string',
          description: 'For explore/plan: quick | medium | very_thorough'
        },
        max_rounds: {
          type: 'number',
          description: 'Max tool rounds (profile default; hard max 25)'
        },
        isolation: {
          type: 'string',
          description:
            'none | worktree. Worker defaults to worktree. Explore/plan/code-reviewer default none.'
        },
        apply: {
          type: 'string',
          description:
            'auto | none. When isolation=worktree, auto (default for worker) copies successful changes into the project tree; none discards them.'
        },
        model: {
          type: 'string',
          description: 'inherit | simple | mid | complex (tier hint for auto routing)'
        },
        background: {
          type: 'boolean',
          description:
            'If true, return immediately with a run id; the subagent continues and posts a system message when done. Use await_agent to block on the result.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'parallel_agents',
    description:
      'Run up to 6 subagents with true concurrency and optional DAG waves. ' +
      'Independent tasks run in parallel (bounded by Settings pool). ' +
      'Use depends_on: ["task-name"] so a worker waits for explores; prior summaries are injected as sibling findings. ' +
      'shared_context on the call (or per task) is prepended to every prompt. ' +
      'If agent is omitted, infers explore/plan/worker/code-reviewer from the prompt. ' +
      'background=true returns handles immediately. Prefer this over sequential spawn for multi-module work.',
    parameters: {
      type: 'object',
      properties: {
        shared_context: {
          type: 'string',
          description: 'Brief shared by all tasks (goals, constraints, glossary) — treated as untrusted data'
        },
        on_dependency_fail: {
          type: 'string',
          description:
            'When a depends_on task fails: skip (default, do not run dependents) | continue (still run) | stop (skip all later waves)'
        },
        tasks: {
          type: 'array',
          description: 'Tasks (max 6). Use name + depends_on for multi-wave pipelines.',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              name: { type: 'string', description: 'Stable label for depends_on and UI' },
              agent: { type: 'string', description: 'Profile name (explore|plan|worker|code-reviewer|custom)' },
              mode: { type: 'string', description: 'Legacy: explore | worker' },
              thoroughness: { type: 'string' },
              max_rounds: { type: 'number' },
              isolation: { type: 'string', description: 'none | worktree' },
              apply: { type: 'string', description: 'auto | none' },
              model: { type: 'string' },
              background: { type: 'boolean' },
              depends_on: {
                type: 'array',
                items: { type: 'string' },
                description: 'Names of sibling tasks that must finish first (DAG wave)'
              },
              shared_context: { type: 'string', description: 'Per-task extra shared brief' }
            },
            required: ['prompt']
          }
        }
      },
      required: ['tasks']
    }
  },
  {
    name: 'list_agents',
    description:
      'List built-in and custom subagent profiles available for spawn_agent / parallel_agents ' +
      '(name, description, source, isolation, model hint, maxTurns). Call when choosing which agent to use.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'await_agent',
    description:
      'Wait for background subagent(s) to finish and return summary. ' +
      'id = run id or name; comma-separated for several; id="*" waits for all running in this session. ' +
      'Optional timeout_ms (default 600000). Prefer after spawn_agent/parallel with background=true.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Run id, name, comma-separated list, or * for all session runs'
        },
        timeout_ms: {
          type: 'number',
          description: 'Max wait in milliseconds (default 600000)'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'cancel_agent',
    description:
      'Cancel a running subagent by run id or name. Pass id="*" to cancel all active subagents for this session.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Run id, name, or * for all in this session'
        }
      },
      required: ['id']
    }
  }
]
