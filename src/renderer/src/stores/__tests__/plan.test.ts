import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanStore } from '../plan'

describe('plan store', () => {
  beforeEach(() => {
    usePlanStore.setState({ bySession: {} })
  })

  it('updates plan items for a session', () => {
    const items = usePlanStore.getState().updatePlan('s1', [
      { content: 'A', status: 'done' },
      { content: 'B', status: 'in_progress' }
    ])
    expect(items).toHaveLength(2)
    expect(usePlanStore.getState().getPlan('s1')[0].status).toBe('done')
  })
})
