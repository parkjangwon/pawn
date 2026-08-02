// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FileEditor from '../FileEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const fs = {
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).api = { fs }
})

const mount = (name = 'note.txt'): void => {
  render(<FileEditor filePath={'/proj/' + name} fileName={name} onClose={() => {}} />)
}

describe('FileEditor', () => {
  it('loads text content, becomes dirty on edit, and saves via writeFile', async () => {
    fs.stat.mockResolvedValue({ size: 12, isFile: true, isDirectory: false, mtime: 0 })
    fs.readFile.mockResolvedValue('hello world')
    fs.writeFile.mockResolvedValue({ ok: true })
    mount()

    await waitFor(() => expect(screen.getByDisplayValue('hello world')).toBeInTheDocument())
    // Line-number gutter renders one row for the single-line file.
    expect(document.querySelector('.rp-fe-ln')?.textContent).toBe('1')

    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello world!' } })
    expect(document.querySelector('.rp-fe-name')?.className).toContain('is-dirty')

    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(fs.writeFile).toHaveBeenCalledWith('/proj/note.txt', 'hello world!'))
  })

  it('reports a binary file instead of rendering garbage', async () => {
    fs.stat.mockResolvedValue({ size: 4, isFile: true, isDirectory: false, mtime: 0 })
    fs.readFile.mockResolvedValue('a\u0000b\u0000')
    mount('blob.bin')

    await waitFor(() => expect(screen.getByText('fileEditor.binary')).toBeInTheDocument())
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('refuses files above the size cap', async () => {
    fs.stat.mockResolvedValue({ size: 5_000_000, isFile: true, isDirectory: false, mtime: 0 })
    mount('huge.txt')

    await waitFor(() => expect(screen.getByText(/fileEditor.tooLarge/)).toBeInTheDocument())
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('renders a syntax-highlighted overlay for a known language', async () => {
    fs.stat.mockResolvedValue({ size: 18, isFile: true, isDirectory: false, mtime: 0 })
    fs.readFile.mockResolvedValue('const greeting = "hi";')
    mount('app.ts')

    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
    const code = document.querySelector('.rp-fe-highlight code')
    expect(code?.getAttribute('class')).toContain('language-typescript')
    // The overlay carries the highlighted spans; the textarea stays transparent.
    expect(code?.innerHTML).toContain('hljs-keyword')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('const greeting = "hi";')
  })
})
