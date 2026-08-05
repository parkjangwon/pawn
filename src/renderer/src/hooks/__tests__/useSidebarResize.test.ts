// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampSidebarWidth,
  readStoredSidebarWidth,
  persistSidebarWidth
} from '../useSidebarResize'

describe('sidebar width helpers', () => {
  it('clamps widths to the min/max bounds', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(300)).toBe(300)
    const expectedMax = Math.min(SIDEBAR_MAX_WIDTH, Math.round(window.innerWidth * 0.4))
    expect(clampSidebarWidth(9999)).toBe(expectedMax)
  })

  it('round-trips through localStorage and re-clamps on read', () => {
    persistSidebarWidth(360)
    expect(readStoredSidebarWidth()).toBe(360)

    persistSidebarWidth(20)
    expect(readStoredSidebarWidth()).toBe(SIDEBAR_MIN_WIDTH)

    localStorage.removeItem('pawn-sidebar-width')
    expect(readStoredSidebarWidth()).toBe(244)
  })
})
