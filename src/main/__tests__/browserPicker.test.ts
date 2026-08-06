import { describe, it, expect } from 'vitest'
import { buildPickerJs } from '../browserPicker'

describe('browserPicker injection script', () => {
  it('produces syntactically valid JS for the page', () => {
    const js = buildPickerJs('What should the agent change?', '↵ Enter to send')
    // new Function only parses — it never runs, so DOM references are fine.
    expect(() => new Function(js)).not.toThrow()
  })

  it('wires the speech bubble, Enter-submit and Shift+Enter newline', () => {
    const js = buildPickerJs('ph', 'hint')
    expect(js).toContain("id = 'pawn-pick-bubble'")
    expect(js).toContain("e.key === 'Enter' && !e.shiftKey")
    expect(js).toContain('state.ready = true')
    expect(js).toContain('window.__pawnPick')
    expect(js).toContain('root.parentNode.removeChild(root)')
    expect(js).toContain('ph')
    expect(js).toContain('hint')
  })

  it('re-injects cleanly after stop (id guard does not leave a zombie root)', () => {
    const js = buildPickerJs('', '')
    expect(js).toContain("if (document.getElementById('pawn-pick-root')) return")
  })
})
