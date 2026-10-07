import { describe, it, expect } from 'vitest'
import { humanizeToolName, toolLabel } from '../toolLabels'

describe('tool labels', () => {
  it('uses the dedicated label, then the tool family, never a raw id', () => {
    expect(toolLabel('write_file').label).toBe('Write file')
    expect(toolLabel('browser_navigate').label).toBe('Browser')
    expect(toolLabel('google_sheets_write').label).toBe('Spreadsheet')
    expect(toolLabel('read_spreadsheet').label).toBe('Spreadsheet')
    expect(toolLabel('google_gmail_search').label).toBe('Email')
    expect(toolLabel('web_search').label).toBe('Web search')
    expect(toolLabel('wiki_write').label).toBe('Wiki')
    expect(toolLabel('github_create_pull').label).toBe('GitHub / GitLab')
    // Unknown / MCP tools: readable words.
    expect(toolLabel('some_new_tool').label).toBe('Some new tool')
    expect(humanizeToolName('mcp__notion__search_pages')).toBe('notion: search pages')
  })
})
