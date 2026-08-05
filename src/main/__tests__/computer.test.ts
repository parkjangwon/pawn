import { describe, it, expect } from 'vitest'
import { parseKeyCombo, normalizeButton, fitThumbnail, imageToLogical } from '../computer/platform'

describe('computer/platform', () => {
  it('parses key combos', () => {
    expect(parseKeyCombo('cmd+c')).toEqual({
      modifiers: expect.arrayContaining([expect.any(String)]),
      key: 'c'
    })
    expect(parseKeyCombo('Return').key.toLowerCase()).toMatch(/return|enter/i)
    expect(parseKeyCombo('ctrl+shift+t').modifiers.length).toBe(2)
  })

  it('normalizes mouse buttons', () => {
    expect(normalizeButton('right')).toBe('right')
    expect(normalizeButton('2')).toBe('right')
    expect(normalizeButton(undefined)).toBe('left')
  })

  it('fits thumbnail width', () => {
    const t = fitThumbnail(3000, 2000, 1500)
    expect(t.width).toBe(1500)
    expect(t.height).toBe(1000)
    const small = fitThumbnail(800, 600, 1600)
    expect(small.width).toBe(800)
  })

  it('maps image coords to logical screen', () => {
    const p = imageToLogical(100, 50, {
      imageWidth: 800,
      imageHeight: 600,
      screenWidth: 1600,
      screenHeight: 1200
    })
    expect(p).toEqual({ x: 200, y: 100 })
  })
})
