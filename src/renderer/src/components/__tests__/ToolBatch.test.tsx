// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ToolBatch from '../ToolBatch'
import type { Message } from '../../stores/app'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: any) => opts?.defaultValue || key })
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ToolBatch', () => {
  it('renders a single tool directly via ToolMessage fallback', () => {
    const singleMsg: Message = {
      id: 'msg-1',
      role: 'system',
      content: '[Tool: read_file] OK\nfile contents',
      createdAt: Date.now()
    }
    const { container } = render(<ToolBatch messages={[singleMsg]} />)
    expect(screen.getByText('toolMessage.read')).toBeInTheDocument()
    expect(container.querySelector('.tool-batch-card')).not.toBeInTheDocument()
  })

  it('groups multiple tools into a batch card with summary chips', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: '[Tool: read_file] OK\ncontent 1', createdAt: Date.now() },
      { id: '2', role: 'system', content: '[Tool: read_file] OK\ncontent 2', createdAt: Date.now() },
      { id: '3', role: 'system', content: '[Tool: grep_search] OK\ncontent 3', createdAt: Date.now() }
    ]
    render(<ToolBatch messages={messages} />)
    expect(screen.getByText('toolMessage.batchDone')).toBeInTheDocument()
    // Readable labels, raw id in the tooltip.
    expect(screen.getByText('toolMessage.read ×2')).toHaveAttribute('title', 'read_file')
    expect(screen.getByText('toolMessage.family.findFiles')).toHaveAttribute('title', 'grep_search')
  })

  it('expands on click to display individual tool items', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: '[Tool: read_file] OK\ncontent 1', createdAt: Date.now() },
      { id: '2', role: 'system', content: '[Tool: write_file] OK\ncontent 2', createdAt: Date.now() }
    ]
    render(<ToolBatch messages={messages} />)
    const headerBtn = screen.getByRole('button')
    fireEvent.click(headerBtn)
    const rows = Array.from(document.querySelectorAll('.tool-message .tool-name')).map((n) => n.textContent)
    expect(rows).toEqual(['toolMessage.read', 'toolMessage.write'])
  })

  it('keeps working when a single-tool batch grows to two (stable hook order)', () => {
    const first: Message = { id: 'a', role: 'system', content: '[Tool: read_file] OK\nx', createdAt: 1 }
    const second: Message = { id: 'b', role: 'system', content: '[Tool: grep_search] OK\ny', createdAt: 2 }
    const { rerender, container } = render(<ToolBatch messages={[first]} />)
    expect(container.querySelector('.tool-batch-card')).toBeNull()
    expect(() => rerender(<ToolBatch messages={[first, second]} />)).not.toThrow()
    expect(container.querySelector('.tool-batch-card')).not.toBeNull()
  })

  it('summarizes files changed, line stats, and duration from structured tool records', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'system',
        content: '[Tool: edit_file] OK\nFile edited',
        createdAt: 1,
        toolMeta: { v: 1, name: 'edit_file', status: 'ok', path: '/p/a.ts', target: '/p/a.ts', added: 12, removed: 3, durationMs: 900 }
      },
      {
        id: '2',
        role: 'system',
        content: '[Tool: shell_exec] OK\nok',
        createdAt: 2,
        toolMeta: { v: 1, name: 'shell_exec', status: 'ok', target: 'npm test', durationMs: 3300 }
      }
    ]
    const { container } = render(<ToolBatch messages={messages} />)
    const header = container.querySelector('.tool-batch-header')!
    expect(header).toHaveTextContent('toolMessage.filesChanged')
    expect(header).toHaveTextContent('+12')
    expect(header).toHaveTextContent('−3')
    expect(header).toHaveTextContent('4.2s')
  })
})

describe('ToolBatch chips', () => {
  it('shows readable labels with the raw tool name as tooltip', () => {
    render(
      <ToolBatch
        messages={[
          { id: 'a', role: 'system', content: '[Tool: write_file] OK\nwritten', createdAt: 1 },
          { id: 'b', role: 'system', content: '[Tool: shell_exec] OK\nok', createdAt: 2 },
          { id: 'c', role: 'system', content: '[Tool: browser_navigate] OK\nok', createdAt: 3 }
        ]}
      />
    )
    const chips = Array.from(document.querySelectorAll('.tool-batch-chip'))
    expect(chips.map((c) => c.textContent)).toEqual(['toolMessage.write', 'toolMessage.shell', 'toolMessage.family.browser'])
    expect(chips.map((c) => c.getAttribute('title'))).toEqual(['write_file', 'shell_exec', 'browser_navigate'])
  })
})
