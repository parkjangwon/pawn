import { describe, it, expect, vi } from 'vitest'

// platform.ts imports electron at module load — stub screen before import.
vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({
      id: 1,
      size: { width: 1440, height: 900 },
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      scaleFactor: 2
    }),
    getAllDisplays: () => [
      {
        id: 1,
        size: { width: 1440, height: 900 },
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        scaleFactor: 2
      }
    ]
  }
}))

import {
  clampLogicalPoint,
  imageToLogical,
  fitThumbnail,
  parseKeyCombo,
  normalizeButton
} from '../platform'

describe('computer platform helpers', () => {
  it('clamps off-screen points into the primary display', () => {
    const r = clampLogicalPoint(-40, 9999)
    expect(r.x).toBe(0)
    expect(r.y).toBe(899)
    expect(r.clamped).toBe(true)
  })

  it('leaves in-bounds points alone', () => {
    const r = clampLogicalPoint(100, 200)
    expect(r).toEqual({ x: 100, y: 200, clamped: false })
  })

  it('maps image coords to logical screen space', () => {
    const r = imageToLogical(400, 300, {
      imageWidth: 800,
      imageHeight: 600,
      screenWidth: 1600,
      screenHeight: 1200
    })
    expect(r).toEqual({ x: 800, y: 600 })
  })

  it('fits thumbnails preserving aspect', () => {
    expect(fitThumbnail(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 })
    expect(fitThumbnail(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('parses key combos and buttons', () => {
    expect(parseKeyCombo('cmd+shift+t').key.toLowerCase()).toBe('t')
    expect(parseKeyCombo('Return')).toEqual({ modifiers: [], key: 'Return' })
    expect(normalizeButton('right')).toBe('right')
    expect(normalizeButton(undefined)).toBe('left')
  })
})
