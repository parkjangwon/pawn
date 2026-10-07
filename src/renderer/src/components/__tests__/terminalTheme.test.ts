// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readPawnTerminalTheme } from '../terminalTheme'

describe('readPawnTerminalTheme', () => {
  it('falls back to parseable colors without stylesheets', () => {
    const theme = readPawnTerminalTheme()
    expect(theme.background).toBe('#161616')
    expect(theme.foreground).toBe('#d4d4d4')
    expect(theme.cursor).toBe('#d4d4d4')
    expect(theme.selectionBackground).toBe('rgba(115, 115, 115, 0.35)')
  })

  it('keeps the fixed ANSI palette', () => {
    const theme = readPawnTerminalTheme()
    expect(theme.red).toBe('#e34c4c')
    expect(theme.green).toBe('#4caf50')
    expect(theme.brightWhite).toBe('#ffffff')
  })

  it('resolves tokens when they are defined', () => {
    document.documentElement.style.setProperty('--bg-primary', 'rgb(10, 20, 30)')
    const theme = readPawnTerminalTheme()
    // jsdom has no canvas: raw computed value passes through unparsed.
    expect(theme.background).toBe('rgb(10, 20, 30)')
    document.documentElement.style.removeProperty('--bg-primary')
  })
})
