import { describe, it, expect } from 'vitest'
import { clampDim, pickShell } from '../terminal'

describe('clampDim', () => {
  it('clamps values to the 2..500 range', () => {
    expect(clampDim(80, 24)).toBe(80)
    expect(clampDim(1, 24)).toBe(2)
    expect(clampDim(10000, 24)).toBe(500)
  })

  it('floors fractional values', () => {
    expect(clampDim(80.9, 24)).toBe(80)
  })

  it('falls back for non-finite or non-number input', () => {
    expect(clampDim(NaN, 24)).toBe(24)
    expect(clampDim(undefined, 24)).toBe(24)
    expect(clampDim('80' as unknown, 24)).toBe(24)
    expect(clampDim(Infinity, 24)).toBe(24)
  })
})

describe('pickShell', () => {
  it('uses SHELL on unix platforms', () => {
    expect(pickShell('darwin', { SHELL: '/opt/homebrew/bin/fish' })).toEqual({
      file: '/opt/homebrew/bin/fish',
      args: []
    })
  })

  it('defaults to /bin/zsh when SHELL is missing', () => {
    expect(pickShell('linux', {})).toEqual({ file: '/bin/zsh', args: [] })
  })

  it('uses ComSpec on Windows when present', () => {
    expect(pickShell('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: []
    })
  })

  it('falls back to powershell on Windows without ComSpec', () => {
    expect(pickShell('win32', {})).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })
})
