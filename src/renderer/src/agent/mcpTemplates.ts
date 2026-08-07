/**
 * One-click MCP server templates (stdio + HTTP).
 * Users still paste secrets; we only write the shape into mcp.json.
 */
export type McpTemplate = {
  id: string
  name: string
  description: string
  scope: 'user' | 'project'
  input:
    | { type?: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
    | { type: 'http' | 'sse'; url: string; env?: Record<string, string> }
}

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Official MCP filesystem server (project-scoped).',
    scope: 'project',
    input: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    }
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub MCP via npx. Set GITHUB_PERSONAL_ACCESS_TOKEN in env after install.',
    scope: 'user',
    input: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }
    }
  },
  {
    id: 'memory',
    name: 'Memory (MCP)',
    description: 'Knowledge graph memory MCP server.',
    scope: 'user',
    input: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory']
    }
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave. Set BRAVE_API_KEY after install.',
    scope: 'user',
    input: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' }
    }
  },
  {
    id: 'remote-http',
    name: 'Remote HTTP (template)',
    description: 'Streamable HTTP remote MCP. Replace URL and optional MCP_TOKEN.',
    scope: 'user',
    input: {
      type: 'http',
      url: 'https://example.com/mcp',
      env: { MCP_TOKEN: '' }
    }
  }
]
