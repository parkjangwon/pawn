import { describe, it, expect, vi, beforeEach } from 'vitest'

const routines: Array<{ enabled: boolean; schedule: string }> = []
vi.mock('electron', () => ({ app: { on: vi.fn(), getLocale: () => 'en', quit: vi.fn() }, dialog: { showMessageBox: vi.fn() } }))
vi.mock('../config', () => ({ loadConfig: () => ({ settings: {} }), saveConfig: vi.fn() }))
vi.mock('../window', () => ({ getMainWindow: () => null }))
vi.mock('../db', () => ({ getAllRoutines: () => routines }))

import { quitStakes } from '../quit'
import { clearAllStreaming, setSessionStreaming } from '../streamingState'

beforeEach(() => {
  routines.length = 0
  clearAllStreaming()
})

describe('quit confirmation stakes', () => {
  it('has nothing at stake when idle and no automation is scheduled (quit without asking)', () => {
    routines.push({ enabled: false, schedule: '{"type":"daily","hour":9}' })
    expect(quitStakes()).toEqual({ running: 0, automations: 0 })
  })

  it('counts running agent sessions and switched-on scheduled automations', () => {
    setSessionStreaming('s1', true)
    setSessionStreaming('s2', true)
    routines.push({ enabled: true, schedule: '{"type":"daily","hour":9}' }, { enabled: true, schedule: '{"type":"interval","minutes":30}' }, { enabled: false, schedule: '{"type":"weekly"}' })
    expect(quitStakes()).toEqual({ running: 2, automations: 2 })
  })
})
