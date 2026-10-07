import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { humanizeToolName, toolLabel } from '../toolLabels'

const t = ((key: string) => key) as unknown as TFunction

describe('tool labels', () => {
  it('uses the dedicated label, then the tool family, never a raw id', () => {
    expect(toolLabel(t, 'write_file').label).toBe('toolMessage.write')
    expect(toolLabel(t, 'browser_navigate').label).toBe('toolMessage.family.browser')
    expect(toolLabel(t, 'google_sheets_write').label).toBe('toolMessage.family.spreadsheet')
    expect(toolLabel(t, 'read_spreadsheet').label).toBe('toolMessage.family.spreadsheet')
    expect(toolLabel(t, 'google_gmail_search').label).toBe('toolMessage.family.email')
    expect(toolLabel(t, 'web_search').label).toBe('toolMessage.family.webSearch')
    expect(toolLabel(t, 'wiki_write').label).toBe('toolMessage.family.wiki')
    expect(toolLabel(t, 'github_create_pull').label).toBe('toolMessage.family.repoHost')
    // Unknown / MCP tools: readable words.
    expect(toolLabel(t, 'some_new_tool').label).toBe('Some new tool')
    expect(humanizeToolName('mcp__notion__search_pages')).toBe('notion: search pages')
  })
})
