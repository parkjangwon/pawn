import type { ToolDefinition } from '../toolDefinitionsTypes'

export const CODECOMMIT_CONNECTION_TOOLS: ToolDefinition[] = [
{
    name: 'codecommit_whoami',
    description: 'Return the connected AWS identity and CodeCommit region. Requires CodeCommit connection in Settings.',
    parameters: { type: 'object', properties: {} }
  },
{
    name: 'codecommit_list_repos',
    description: 'List AWS CodeCommit repositories in the connected region. Requires CodeCommit connection.',
    parameters: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Max repos (default 25)' },
        next_token: { type: 'string', description: 'Pagination token from previous call' }
      }
    }
  },
{
    name: 'codecommit_get_repo',
    description: 'Get CodeCommit repository metadata and clone URLs. Requires CodeCommit connection.',
    parameters: {
      type: 'object',
      properties: { repository_name: { type: 'string', description: 'Repository name' } },
      required: ['repository_name']
    }
  },
{
    name: 'codecommit_list_branches',
    description: 'List branches in a CodeCommit repository. Requires CodeCommit connection.',
    parameters: {
      type: 'object',
      properties: {
        repository_name: { type: 'string', description: 'Repository name' },
        next_token: { type: 'string', description: 'Pagination token' }
      },
      required: ['repository_name']
    }
  },
{
    name: 'codecommit_get_branch',
    description: 'Get the tip commit of a CodeCommit branch. Requires CodeCommit connection.',
    parameters: {
      type: 'object',
      properties: {
        repository_name: { type: 'string', description: 'Repository name' },
        branch_name: { type: 'string', description: 'Branch name' }
      },
      required: ['repository_name', 'branch_name']
    }
  },
{
    name: 'codecommit_list_commits',
    description: 'Walk recent commits from a branch tip (or commit_specifier) on CodeCommit. Requires CodeCommit connection.',
    parameters: {
      type: 'object',
      properties: {
        repository_name: { type: 'string', description: 'Repository name' },
        branch_name: { type: 'string', description: 'Branch name (default main/master/default)' },
        commit_specifier: { type: 'string', description: 'Commit id to start from' },
        max_results: { type: 'number', description: 'Max commits (default 15)' }
      },
      required: ['repository_name']
    }
  },
{
    name: 'codecommit_get_file',
    description: 'Read a file or list a folder from a CodeCommit repository. Requires CodeCommit connection.',
    parameters: {
      type: 'object',
      properties: {
        repository_name: { type: 'string', description: 'Repository name' },
        file_path: { type: 'string', description: 'File or folder path in repo' },
        commit_specifier: { type: 'string', description: 'Branch name or commit id (optional)' }
      },
      required: ['repository_name', 'file_path']
    }
  }
]
