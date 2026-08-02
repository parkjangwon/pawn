// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarkdownRenderer from '../MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renders http links with noopener noreferrer', () => {
    render(<MarkdownRenderer content="[docs](https://example.com/docs)" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('blocks javascript: links entirely', () => {
    render(<MarkdownRenderer content="[click](javascript:alert(1))" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('click')).toBeInTheDocument()
  })

  it('blocks data: and vbscript: links', () => {
    render(<MarkdownRenderer content="[a](data:text/html,hi) [b](vbscript:msgbox(1))" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('allows mailto links', () => {
    render(<MarkdownRenderer content="[mail](mailto:hi@example.com)" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'mailto:hi@example.com')
  })

  it('escapes raw HTML instead of executing it', () => {
    render(<MarkdownRenderer content={'<img src=x onerror="window.__xss=1">'} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined()
  })
})
