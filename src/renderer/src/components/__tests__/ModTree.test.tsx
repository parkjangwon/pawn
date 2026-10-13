// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModTree from '../ModTree'

describe('ModTree design-system mapping', () => {
  it('renders a Button node with the design-system button class', () => {
    render(<ModTree tree={{ type: 'Button', props: { text: 'Run it' } }} plugin="test-mod" />)
    const btn = screen.getByRole('button', { name: 'Run it' })
    expect(btn.classList.contains('pawn-btn')).toBe(true)
  })

  it('renders an Input node with the design-system input class', () => {
    render(
      <ModTree
        tree={{ type: 'Input', props: { id: 'nickname', placeholder: 'Your nickname' } }}
        plugin="test-mod"
      />
    )
    const input = screen.getByPlaceholderText('Your nickname')
    expect(input.classList.contains('pawn-input')).toBe(true)
  })

  it('renders a Select node with the design-system select wrapper', () => {
    const { container } = render(
      <ModTree
        tree={{ type: 'Select', props: { id: 'choice', options: ['alpha', 'beta'] } }}
        plugin="test-mod"
      />
    )
    expect(container.querySelector('.pawn-select')).not.toBeNull()
    expect(screen.getByRole('option', { name: 'alpha' })).toBeInTheDocument()
  })
})
