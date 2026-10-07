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

  it('opens file:// links inside Pawn, reveals on ⌘-click, and reports missing files', async () => {
    const { useFilesPanelStore } = await import('../../stores/filesPanel')
    const reveal = vi.fn(async () => ({ ok: true }))
    const files: Record<string, boolean> = { '/tmp/project/src/app.ts': true }
    const toasts: string[] = []
    const onToast = (e: Event): void => void toasts.push((e as CustomEvent).detail.message)
    window.addEventListener('pawn:toast', onToast)
    ;(window as any).api = {
      workspace: { reveal },
      fs: { stat: vi.fn(async (p: string) => (files[p] ? { isFile: true, isDirectory: false, size: 1, mtime: 0 } : { error: 'ENOENT' })) }
    }
    render(<MarkdownRenderer content="[app.ts](file:///tmp/project/src/app.ts) and [gone](file:///tmp/project/gone.ts)" />)
    const [link, gone] = screen.getAllByRole('link') as HTMLAnchorElement[]
    expect(link).toHaveAttribute('href', 'file:///tmp/project/src/app.ts')
    fireEvent.click(link)
    await vi.waitFor(() => expect(useFilesPanelStore.getState().pendingPath).toBe('/tmp/project/src/app.ts'))
    expect(reveal).not.toHaveBeenCalled()
    fireEvent.click(link, { metaKey: true })
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith('/tmp/project/src/app.ts'))
    fireEvent.click(gone)
    await vi.waitFor(() => expect(toasts[0]).toBe('File not found: /tmp/project/gone.ts'))
    window.removeEventListener('pawn:toast', onToast)
  })

  it('resolves relative links against the chat folder and links existing inline-code paths', async () => {
    const { MarkdownBaseDirContext } = await import('../LocalFileLinks')
    ;(window as any).api = {
      fs: { stat: vi.fn(async (p: string) => (p === '/proj/charts/sales.svg' ? { isFile: true, isDirectory: false, size: 1, mtime: 0 } : { error: 'ENOENT' })) }
    }
    render(
      <MarkdownBaseDirContext.Provider value="/proj">
        <MarkdownRenderer content={'[readme](./README.md#L3) · `charts/sales.svg` · `charts/missing.svg` · `npm test`'} />
      </MarkdownBaseDirContext.Provider>
    )
    expect(screen.getByRole('link', { name: 'readme' })).toHaveAttribute('href', 'file:///proj/README.md')
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'charts/sales.svg' })).toHaveAttribute('href', 'file:///proj/charts/sales.svg'))
    expect(screen.queryByRole('link', { name: 'charts/missing.svg' })).not.toBeInTheDocument()
    expect(screen.getByText('npm test').tagName).toBe('CODE')
  })

  it('shows local images inline through the main process (never a file: fetch)', async () => {
    const readImage = vi.fn(async (p: string) =>
      p.endsWith('chart.png') ? { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', size: 8, mtime: 1 } : { error: 'File not found' }
    )
    ;(window as any).api = { fs: { readImage, stat: vi.fn(async () => ({ isFile: true, isDirectory: false, size: 1, mtime: 0 })) } }
    render(<MarkdownRenderer content={'![Sales chart](file:///p/charts/chart.png)\n\n![Lost](/p/lost.png)'} />)
    const img = await screen.findByRole('button', { name: 'Sales chart' })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    expect(readImage).toHaveBeenCalledWith('/p/charts/chart.png')
    expect(await screen.findByText(/Lost — File not found/)).toBeInTheDocument()
    // Remote images still never auto-load.
    render(<MarkdownRenderer content="![remote](https://evil.example/x.png)" />)
    expect(screen.getByRole('link', { name: 'remote' })).toHaveAttribute('href', 'https://evil.example/x.png')
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
    const dialog = screen.getByRole('dialog', { name: 'Enlarged image' })
    expect(dialog).toBeInTheDocument()
    const enlarged = dialog.querySelector('img.md-image-lightbox-img')
    expect(enlarged).toHaveAttribute('src', src)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
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
    const toggle = screen.getByRole('button', { name: 'Show all 45 lines' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(wrapper).not.toHaveAttribute('data-folded')
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves short code blocks unfolded', () => {
    const { container } = render(<MarkdownRenderer content={'```\na\nb\n```'} />)
    expect(container.querySelector('.code-block-wrapper')).not.toHaveAttribute('data-folded')
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
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

  it('renders math blocks and single-dollar inline math via KaTeX', () => {
    const { container } = render(<MarkdownRenderer content={'$$x^2$$ and $E=mc^2$'} />)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
  })

  it('leaves prices and shell variables as plain text, not math', () => {
    const { container } = render(<MarkdownRenderer content={'$5-$10 and $HOME'} />)
    expect(container.querySelector('.katex')).not.toBeInTheDocument()
    expect(container.textContent).toMatch(/\$5-\$10/)
  })

  it('renders mermaid fences without crashing (diagram or code fallback)', () => {
    const { container } = render(<MarkdownRenderer content={'```mermaid\ngraph TD\n```'} />)
    expect(
      container.querySelector('.md-mermaid-body svg') ?? container.querySelector('.code-block-wrapper')
    ).toBeInTheDocument()
  })

  it('accepts the streaming flag for in-progress messages', () => {
    const { container } = render(<MarkdownRenderer content={'# Hi\n\n```ts\nconst a = 1\n```'} streaming />)
    expect(container.querySelector('.markdown-body')).toBeInTheDocument()
  })
})
