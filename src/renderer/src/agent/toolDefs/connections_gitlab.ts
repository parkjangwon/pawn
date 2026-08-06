import type { ToolDefinition } from '../toolDefinitionsTypes'

export const GITLAB_CONNECTION_TOOLS: ToolDefinition[] = [
{
    name: 'gitlab_whoami',
    description: 'Return the connected GitLab user. Requires GitLab PAT connection in Settings.',
    parameters: { type: 'object', properties: {} }
  },
{
    name: 'gitlab_list_projects',
    description: 'List GitLab projects for the connected user (membership by default). Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional name search' },
        membership: { type: 'boolean', description: 'Only projects you are a member of (default true)' },
        per_page: { type: 'number', description: 'Max projects (default 20)' }
      }
    }
  },
{
    name: 'gitlab_get_project',
    description: 'Get GitLab project metadata. project is numeric id or "group/name". Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: { project: { type: 'string', description: 'id or group/name' } },
      required: ['project']
    }
  },
{
    name: 'gitlab_list_issues',
    description: 'List issues for a GitLab project. Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        state: { type: 'string', enum: ['opened', 'closed', 'all'], description: 'Issue state' },
        labels: { type: 'string', description: 'Comma-separated labels' },
        per_page: { type: 'number', description: 'Max results (default 20)' }
      },
      required: ['project']
    }
  },
{
    name: 'gitlab_get_issue',
    description: 'Get a GitLab issue body and recent notes. Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        iid: { type: 'number', description: 'Issue IID (project-scoped number)' }
      },
      required: ['project', 'iid']
    }
  },
{
    name: 'gitlab_list_merge_requests',
    description: 'List merge requests for a GitLab project. Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], description: 'MR state' },
        per_page: { type: 'number', description: 'Max results (default 20)' }
      },
      required: ['project']
    }
  },
{
    name: 'gitlab_get_merge_request',
    description: 'Get a merge request details and changed files. Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        iid: { type: 'number', description: 'MR IID' }
      },
      required: ['project', 'iid']
    }
  },
{
    name: 'gitlab_list_commits',
    description: 'List recent commits on a GitLab project. Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        ref: { type: 'string', description: 'Branch, tag, or SHA' },
        path: { type: 'string', description: 'Only commits touching this path' },
        per_page: { type: 'number', description: 'Max results (default 15)' }
      },
      required: ['project']
    }
  },
{
    name: 'gitlab_get_file',
    description: 'Read a file (or list a directory) from a GitLab repo. Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        path: { type: 'string', description: 'File or directory path in repo' },
        ref: { type: 'string', description: 'Branch, tag, or commit (optional)' }
      },
      required: ['project', 'path']
    }
  },
{
    name: 'gitlab_search',
    description: 'Global search on the connected GitLab instance (projects, issues, merge_requests, blobs, commits). Requires GitLab connection.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text' },
        scope: {
          type: 'string',
          enum: ['projects', 'issues', 'merge_requests', 'blobs', 'commits'],
          description: 'Search scope (default projects)'
        },
        per_page: { type: 'number', description: 'Max results (default 15)' }
      },
      required: ['query']
    }
  },
{
    name: 'gitlab_create_issue',
    description: 'Create a GitLab issue. Requires GitLab PAT with api scope.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue description (markdown)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names' }
      },
      required: ['project', 'title']
    }
  },
{
    name: 'gitlab_comment',
    description: 'Comment (note) on a GitLab issue or merge request. Requires GitLab PAT with api scope.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        iid: { type: 'number', description: 'Issue or MR IID' },
        body: { type: 'string', description: 'Comment markdown' },
        type: { type: 'string', enum: ['issue', 'merge_request'], description: 'Target type (default issue)' }
      },
      required: ['project', 'iid', 'body']
    }
  },
{
    name: 'gitlab_create_merge_request',
    description: 'Create a GitLab merge request. Requires GitLab PAT with api scope.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'id or group/name' },
        title: { type: 'string', description: 'MR title' },
        source_branch: { type: 'string', description: 'Source branch' },
        target_branch: { type: 'string', description: 'Target branch' },
        body: { type: 'string', description: 'MR description' },
        draft: { type: 'boolean', description: 'Create as draft' }
      },
      required: ['project', 'title', 'source_branch', 'target_branch']
    }
  }
]
