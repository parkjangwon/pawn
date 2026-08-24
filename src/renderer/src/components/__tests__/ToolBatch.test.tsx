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
    expect(screen.getByText('Executed 3 operations')).toBeInTheDocument()
    expect(screen.getByText('read_file ×2')).toBeInTheDocument()
    expect(screen.getByText('grep_search')).toBeInTheDocument()
  })

  it('expands on click to display individual tool items', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: '[Tool: read_file] OK\ncontent 1', createdAt: Date.now() },
      { id: '2', role: 'system', content: '[Tool: write_file] OK\ncontent 2', createdAt: Date.now() }
    ]
    render(<ToolBatch messages={messages} />)
    const headerBtn = screen.getByRole('button')
    fireEvent.click(headerBtn)
    expect(screen.getByText('toolMessage.read')).toBeInTheDocument()
    expect(screen.getByText('toolMessage.write')).toBeInTheDocument()
  })
})
