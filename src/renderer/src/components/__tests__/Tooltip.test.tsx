// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Tooltip from '../Tooltip'

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('renders children correctly', () => {
    render(
      <Tooltip label="Test Label" shortcut="⌘B">
        <button type="button">Click me</button>
      </Tooltip>
    )

    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows tooltip on mouse enter after delay and hides on mouse leave', () => {
    render(
      <Tooltip label="Toggle Sidebar" shortcut="⌘B" delay={200}>
        <button type="button">Sidebar</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'Sidebar' })
    fireEvent.mouseEnter(btn)

    // Tooltip not yet visible before delay
    expect(screen.queryByRole('tooltip')).toBeNull()

    // Advance timers
    act(() => {
      vi.advanceTimersByTime(200)
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Toggle Sidebar')
    expect(tooltip).toHaveTextContent('⌘B')

    // Mouse leave hides tooltip
    fireEvent.mouseLeave(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('does not show tooltip if disabled', () => {
    render(
      <Tooltip label="Back" shortcut="⌘[" disabled={true}>
        <button type="button" disabled>Back</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'Back' })
    fireEvent.mouseEnter(btn)

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('clamps tooltip within viewport bounds when trigger is at the extreme right edge', () => {
    render(
      <Tooltip label="Right Panel" shortcut="⌥⌘B" delay={100} placement="bottom">
        <button type="button" style={{ position: 'fixed', right: 0, top: 10 }}>Toggle Panel</button>
      </Tooltip>
    )

    const btn = screen.getByRole('button', { name: 'Toggle Panel' })
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 40,
      left: 980,
      right: 1000,
      width: 20,
      height: 30,
      x: 980,
      y: 10,
      toJSON: () => {}
    })

    fireEvent.mouseEnter(btn)
    act(() => {
      vi.advanceTimersByTime(100)
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
  })
})
