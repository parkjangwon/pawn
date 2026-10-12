// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { readPawnTerminalTheme } from '../terminalTheme'

afterEach(() => {
  document.querySelector('.app')?.remove()
})

describe('readPawnTerminalTheme', () => {
  it('falls back to parseable colors without stylesheets', () => {
    const theme = readPawnTerminalTheme()
    expect(theme.background).toBe('#161616')
    expect(theme.foreground).toBe('#d4d4d4')
    expect(theme.cursor).toBe('#d4d4d4')
    expect(theme.selectionBackground).toBe('rgba(115, 115, 115, 0.35)')
  })

  it('uses the dark ANSI palette by default', () => {
    const theme = readPawnTerminalTheme()
    expect(theme.red).toBe('#e34c4c')
    expect(theme.green).toBe('#4caf50')
    expect(theme.brightWhite).toBe('#ffffff')
  })

  it('resolves tokens from the .app element and picks the light palette', () => {
    const app = document.createElement('div')
    app.className = 'app light'
    app.style.setProperty('--bg-secondary', 'rgb(248, 248, 248)')
    document.body.appendChild(app)

    const theme = readPawnTerminalTheme()
    // jsdom has no canvas: raw computed value passes through unparsed.
    expect(theme.background).toBe('rgb(248, 248, 248)')
    expect(theme.red).toBe('#c62828')
    expect(theme.black).toBe('#262626')
    expect(theme.brightWhite).toBe('#a5a5a5')
  })

  it('resolves tokens from documentElement when .app is absent', () => {
    document.documentElement.style.setProperty('--bg-secondary', 'rgb(10, 20, 30)')
    const theme = readPawnTerminalTheme()
    expect(theme.background).toBe('rgb(10, 20, 30)')
    document.documentElement.style.removeProperty('--bg-secondary')
  })
})
