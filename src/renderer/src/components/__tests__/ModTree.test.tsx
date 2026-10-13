// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import ModTree from '../ModTree'
import { getModRuntime, __resetModRuntimeForTests } from '../../agent/mods'
import { useModsUiStore } from '../../agent/mods/uiStore'

describe('ModTree events', () => {
  let emit: { mock: { calls: unknown[][] } }
  let renderSpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    __resetModRuntimeForTests()
    useModsUiStore.getState().clearSessionUi()
    const rt = getModRuntime()
    emit = vi.spyOn(rt, 'emit').mockResolvedValue(undefined) as unknown as { mock: { calls: unknown[][] } }
    renderSpy = vi.spyOn(rt, 'emitUiRender') as unknown as ReturnType<typeof vi.fn>
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const tree = { type: 'Box', props: { children: [{ type: 'Input', props: { id: 'note', placeholder: 'Note', value: '' } }, { type: 'Button', props: { id: 'go', text: 'Go' } }] } }
  const inputEvents = (): unknown[] => emit.mock.calls.filter((c) => c[0] === 'ui.input')

  it('sends one ui.input for Enter followed by blur', async () => {
    render(<ModTree tree={tree} plugin="m" surfaceId="s" />)
    const input = screen.getByPlaceholderText('Note')
    fireEvent.change(input, { target: { value: 'secret note' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await Promise.resolve()
    expect(inputEvents()).toHaveLength(1)
  })

  it('blur without a change sends nothing; a changed blur sends once', async () => {
    render(<ModTree tree={tree} plugin="m" surfaceId="s" />)
    const input = screen.getByPlaceholderText('Note')
    fireEvent.blur(input)
    expect(inputEvents()).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.blur(input)
    await Promise.resolve()
    expect(inputEvents()).toHaveLength(1)
  })

  it('logs the control id, not the typed text, and leaves the redraw to the chrome', async () => {
    render(<ModTree tree={tree} plugin="m" surfaceId="s" />)
    const input = screen.getByPlaceholderText('Note')
    const before = useModsUiStore.getState().renderGeneration
    fireEvent.change(input, { target: { value: 'secret note' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    const log = useModsUiStore.getState().timeline.map((t) => t.text)
    expect(log).toEqual(['Edited note.'])
    expect(log.join(' ')).not.toContain('secret')
    expect(useModsUiStore.getState().renderGeneration).toBe(before + 1)
    expect(renderSpy).not.toHaveBeenCalled()
  })

  it('a button press bumps the render generation once and does not draw itself', async () => {
    render(<ModTree tree={tree} plugin="m" surfaceId="s" />)
    const before = useModsUiStore.getState().renderGeneration
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(emit.mock.calls.filter((c) => c[0] === 'ui.press')).toHaveLength(1)
    expect(useModsUiStore.getState().renderGeneration).toBe(before + 1)
    expect(renderSpy).not.toHaveBeenCalled()
  })

  it('does not add a redraw when the mod handler already invalidated', async () => {
    ;(emit as unknown as { mockImplementation: (fn: () => Promise<undefined>) => void }).mockImplementation(async () => {
      useModsUiStore.getState().invalidate()
      return undefined
    })
    render(<ModTree tree={tree} plugin="m" surfaceId="s" />)
    const before = useModsUiStore.getState().renderGeneration
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useModsUiStore.getState().renderGeneration).toBe(before + 1)
  })
})
