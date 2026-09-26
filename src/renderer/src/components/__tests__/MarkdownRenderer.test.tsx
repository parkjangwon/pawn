// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MarkdownRenderer from '../MarkdownRenderer'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

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

  it('renders file:// links as local reveal shortcuts', () => {
    const reveal = vi.fn(async () => ({ ok: true }))
    ;(window as any).api = { workspace: { reveal } }
    render(<MarkdownRenderer content="[app.ts](file:///tmp/project/src/app.ts)" />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link).toHaveAttribute('href', 'file:///tmp/project/src/app.ts')
    fireEvent.click(link)
    expect(reveal).toHaveBeenCalledWith('/tmp/project/src/app.ts')
  })

  it('renders data:image markdown attachments (not broken placeholders)', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    render(<MarkdownRenderer content={`look\n\n![shot.png](${src})`} />)
    const img = screen.getByRole('button', { name: 'shot.png' })
    expect(img).toHaveAttribute('src', src)
    expect(img).toHaveClass('md-inline-image')
  })

  it('opens a lightbox on double-click and closes via X / backdrop / Escape', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    render(<MarkdownRenderer content={`![shot.png](${src})`} />)
    const open = (): void => {
      fireEvent.doubleClick(screen.getByRole('button', { name: 'shot.png' }))
    }

    open()
    const dialog = screen.getByRole('dialog', { name: 'chat.imageLightbox' })
    expect(dialog).toBeInTheDocument()
    const enlarged = dialog.querySelector('img.md-image-lightbox-img')
    expect(enlarged).toHaveAttribute('src', src)

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    open()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('still blocks non-image data: URLs on img src', () => {
    render(<MarkdownRenderer content={'![x](data:text/html;base64,PHNjcmlwdD4=)'} />)
    const img = screen.queryByRole('img')
    // defaultUrlTransform empties unsafe schemes → no usable src
    if (img) expect(img.getAttribute('src') || '').not.toMatch(/^data:text/)
  })

  it('escapes raw HTML instead of executing it', () => {
    render(<MarkdownRenderer content={'<img src=x onerror="window.__xss=1">'} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined()
  })

  it('folds long code blocks and expands them on demand', () => {
    const code = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n')
    const { container } = render(<MarkdownRenderer content={'```ts\n' + code + '\n```'} />)
    const wrapper = container.querySelector('.code-block-wrapper')!
    expect(wrapper).toHaveAttribute('data-folded', 'true')
    const toggle = screen.getByRole('button', { name: 'markdown.expandCode' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(wrapper).not.toHaveAttribute('data-folded')
    expect(screen.getByRole('button', { name: 'markdown.collapseCode' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves short code blocks unfolded', () => {
    const { container } = render(<MarkdownRenderer content={'```\na\nb\n```'} />)
    expect(container.querySelector('.code-block-wrapper')).not.toHaveAttribute('data-folded')
    expect(screen.queryByRole('button', { name: 'markdown.expandCode' })).not.toBeInTheDocument()
  })

  it('unfolds when conversation find reveals a match inside', () => {
    const code = Array.from({ length: 40 }, (_, i) => `row ${i}`).join('\n')
    const { container } = render(<MarkdownRenderer content={'```\n' + code + '\n```'} />)
    const wrapper = container.querySelector('.code-block-wrapper')!
    act(() => {
      wrapper.dispatchEvent(new CustomEvent('pawn:reveal'))
    })
    expect(wrapper).not.toHaveAttribute('data-folded')
  })
})
