import { describe, expect, it } from 'vitest'
import { timelineStage } from '../timelineStage'

describe('timelineStage', () => {
  it('keeps agent actions on the timeline palette', () => {
    expect(timelineStage('web_search')).toBe('grep')
    expect(timelineStage('grep_search')).toBe('grep')
    expect(timelineStage('read_file')).toBe('read')
    expect(timelineStage('browser_snapshot')).toBe('read')
    expect(timelineStage('edit_file')).toBe('edit')
    expect(timelineStage('shell_exec')).toBe('edit')
    expect(timelineStage('lsp_rename')).toBe('edit')
    expect(timelineStage('decide')).toBe('thinking')
  })
})