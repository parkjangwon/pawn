// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TriggerMenu from '../TriggerMenu'

// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn()

describe('TriggerMenu', () => {
  it('renders the $ gambit menu and selects on mouse down', () => {
    const onSelect = vi.fn()
    const item = { id: 'gambit:ulw', label: '$ulw <goal>', description: 'Ultra Work · keeps working', hint: '$ultrawork', insert: '$ulw ' }
    render(<TriggerMenu open trigger="$" items={[item]} selectedIndex={0} title="Gambits · keyword modes" onSelect={onSelect} onHover={() => {}} />)
    expect(screen.getByText('$')).toHaveClass('trigger-menu-tag')
    expect(screen.getByText('Gambits · keyword modes')).toBeInTheDocument()
    const opt = screen.getByRole('option', { name: /\$ulw <goal>/ })
    expect(opt).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('$ultrawork')).toBeInTheDocument()
    fireEvent.mouseDown(opt)
    expect(onSelect).toHaveBeenCalledWith(item)
  })
})
