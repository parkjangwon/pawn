import type { ToolDefinition } from '../toolDefinitionsTypes'

export const GITHUB_CONNECTION_TOOLS: ToolDefinition[] = [
{
    name: 'github_whoami',
    description: 'Return the connected GitHub login. Requires GitHub connection in Settings.',
    parameters: { type: 'object', properties: {} }
  },
{
    name: 'github_list_repos',
    description: 'List repositories for the connected GitHub user (sorted by recent update). Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        visibility: { type: 'string', enum: ['all', 'public', 'private'], description: 'Filter visibility' },
        per_page: { type: 'number', description: 'Max repos (default 20)' },
        affiliation: { type: 'string', description: 'owner,collaborator,organization_member (comma-separated)' }
      }
    }
  },
{
    name: 'github_get_repo',
    description: 'Get repository metadata. repo is "owner/name". Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'owner/name' } },
      required: ['repo']
    }
  },
{
    name: 'github_list_issues',
    description: 'List issues (not PRs) for a repo. Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state' },
        labels: { type: 'string', description: 'Comma-separated labels' },
        per_page: { type: 'number', description: 'Max results (default 20)' }
      },
      required: ['repo']
    }
  },
{
    name: 'github_get_issue',
    description: 'Get an issue (or PR-as-issue) body and recent comments. Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        number: { type: 'number', description: 'Issue number' }
      },
      required: ['repo', 'number']
    }
  },
{
    name: 'github_list_pulls',
    description: 'List pull requests for a repo. Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state' },
        per_page: { type: 'number', description: 'Max results (default 20)' }
      },
      required: ['repo']
    }
  },
{
    name: 'github_get_pull',
    description: 'Get a pull request details and changed files list. Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        number: { type: 'number', description: 'PR number' }
      },
      required: ['repo', 'number']
    }
  },
{
    name: 'github_review_pull',
    description:
      'Full PR review pack: description, commits, existing reviews, CI checks, file patches (truncated), and a review checklist. Prefer this when the user asks to review a PR. Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        number: { type: 'number', description: 'PR number' }
      },
      required: ['repo', 'number']
    }
  },
{
    name: 'github_list_commits',
    description: 'List recent commits on a repo (optional branch sha and path). Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        sha: { type: 'string', description: 'Branch or commit SHA' },
        path: { type: 'string', description: 'Only commits touching this path' },
        per_page: { type: 'number', description: 'Max results (default 15)' }
      },
      required: ['repo']
    }
  },
{
    name: 'github_get_file',
    description: 'Read a file (or list a directory) from a GitHub repo via Contents API. Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        path: { type: 'string', description: 'File or directory path in repo' },
        ref: { type: 'string', description: 'Branch, tag, or commit (optional)' }
      },
      required: ['repo', 'path']
    }
  },
{
    name: 'github_search_code',
    description: 'Search code across GitHub (e.g. "repo:owner/name foo", "language:ts filename:foo"). Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GitHub code search query' },
        per_page: { type: 'number', description: 'Max results (default 10)' }
      },
      required: ['query']
    }
  },
{
    name: 'github_search_issues',
    description: 'Search issues/PRs (e.g. "repo:owner/name is:open label:bug", "is:pr author:me"). Requires GitHub connection.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GitHub issues search query' },
        per_page: { type: 'number', description: 'Max results (default 15)' }
      },
      required: ['query']
    }
  },
{
    name: 'github_create_issue',
    description: 'Create a GitHub issue. Requires GitHub connection with repo scope.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (markdown)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names' }
      },
      required: ['repo', 'title']
    }
  },
{
    name: 'github_draft_issue',
    description:
      'Draft a structured bug/feature issue (summary, steps, expected/actual, environment, context). Default create=false returns markdown only. Set create=true with repo to open on GitHub. Use after terminal_read / browser_screenshot / computer_screenshot when filing a bug — put observations in context (images cannot be uploaded via API).',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name (required if create=true)' },
        title: { type: 'string', description: 'Issue title' },
        summary: { type: 'string', description: 'Short summary' },
        steps: { type: 'string', description: 'Steps to reproduce' },
        expected: { type: 'string', description: 'Expected behavior' },
        actual: { type: 'string', description: 'Actual behavior' },
        environment: { type: 'string', description: 'OS, app version, etc.' },
        context: {
          type: 'string',
          description: 'Logs, terminal excerpts, screenshot descriptions, stack traces'
        },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
        create: {
          type: 'boolean',
          description: 'If true, create the issue on GitHub (default false = draft only)'
        }
      },
      required: ['title']
    }
  },
{
    name: 'github_comment',
    description: 'Comment on an issue or pull request. Requires GitHub connection with repo scope.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        number: { type: 'number', description: 'Issue/PR number' },
        body: { type: 'string', description: 'Comment markdown' }
      },
      required: ['repo', 'number', 'body']
    }
  },
{
    name: 'github_create_pull',
    description: 'Create a pull request. Requires GitHub connection with repo scope.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name' },
        title: { type: 'string', description: 'PR title' },
        head: { type: 'string', description: 'Head branch (or user:branch)' },
        base: { type: 'string', description: 'Base branch' },
        body: { type: 'string', description: 'PR body' },
        draft: { type: 'boolean', description: 'Create as draft' }
      },
      required: ['repo', 'title', 'head', 'base']
    }
  }
]
