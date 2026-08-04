// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DiffView from '../DiffView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('DiffView', () => {
  it('renders the filename, stats and diff lines', () => {
    render(<DiffView oldText={'a\nb'} newText={'a\nc'} filename="src/x.ts" />)
    expect(screen.getByText('src/x.ts')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('c')).toBeInTheDocument()
  })

  it('collapses and expands on header click', () => {
    render(<DiffView oldText="a" newText="b" />)
    expect(screen.getByText('b')).toBeInTheDocument()

    fireEvent.click(screen.getByText('file'))
    expect(screen.queryByText('b')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('file'))
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('truncates long diffs and reveals everything on demand', () => {
    const oldText = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    const newText = oldText + '\nextra'
    render(<DiffView oldText={oldText} newText={newText} maxLines={3} />)

    const lines = screen.getAllByText(/^line\d+$/)
    expect(lines.length).toBeLessThan(10)
    expect(screen.getByText('diffView.showAll')).toBeInTheDocument()

    fireEvent.click(screen.getByText('diffView.showAll'))
    expect(screen.getByText('extra')).toBeInTheDocument()
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument()
  })
})
