// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ToolMessage from '../ToolMessage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const expand = (): void => {
  fireEvent.click(document.querySelector('.tool-message-header') as HTMLElement)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ToolMessage', () => {
  it('renders the tool name and OK status', () => {
    render(<ToolMessage content="[Tool: write_file] OK\nwrote 5 chars" />)
    expect(screen.getByText('toolMessage.write')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('shows ERR for failed tools', () => {
    render(<ToolMessage content="[Tool: shell_exec] ERROR\ncommand not found" />)
    expect(screen.getByText('ERR')).toBeInTheDocument()
  })

  it('expands on header click and shows the output without the diff marker', () => {
    const content = '[Tool: write_file] OK\nwrote 5 chars\n__DIFF__:{"filename":"a.ts","oldText":"old","newText":"new"}'
    render(<ToolMessage content={content} />)
    expect(screen.queryByText('wrote 5 chars')).not.toBeInTheDocument()

    expand()
    expect(screen.getByText('wrote 5 chars')).toBeInTheDocument()
    expect(screen.queryByText('__DIFF__:')).not.toBeInTheDocument()
  })

  it('renders a DiffView preview for the JSON marker', () => {
    const content = '[Tool: edit_file] OK\nedited\n__DIFF__:{"filename":"src/a.ts","oldText":"old","newText":"new"}'
    render(<ToolMessage content={content} />)
    expand()
    expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
  })

  it('still parses legacy <<<DIFF blocks', () => {
    const content = '[Tool: edit_file] OK\nedited\n<<<DIFF:legacy.ts>>>\n--- old\nabc\n+++ new\nabd\n<<<END>>>'
    render(<ToolMessage content={content} />)
    expand()
    expect(screen.getByText('legacy.ts')).toBeInTheDocument()
  })

  it('turns File created/written paths into clickable reveal links', () => {
    const reveal = vi.fn(async () => ({ ok: true }))
    ;(window as any).api = { workspace: { reveal } }
    const content = '[Tool: write_file] OK\nFile created: /tmp/project/src/app.ts\n'
    render(<ToolMessage content={content} />)
    expand()
    const link = screen.getByText('/tmp/project/src/app.ts') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    fireEvent.click(link)
    expect(reveal).toHaveBeenCalledWith('/tmp/project/src/app.ts')
  })
})
