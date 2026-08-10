import { describe, it, expect } from 'vitest'
import { BrowserTabManager } from '../browserTabs'

describe('BrowserTabManager', () => {
  it('creates tabs with stable ids and makes each new tab active', () => {
    const m = new BrowserTabManager()
    const a = m.create()
    const b = m.create({ url: 'https://b.dev' })
    expect(a.id).toBe('tab-1')
    expect(b.id).toBe('tab-2')
    expect(m.count).toBe(2)
    expect(m.activeId).toBe(b.id)
    expect(m.active?.url).toBe('https://b.dev')
    expect(m.list.map((t) => t.id)).toEqual(['tab-1', 'tab-2'])
  })

  it('switch() changes the active tab and is a no-op for unknown/active ids', () => {
    const m = new BrowserTabManager()
    const a = m.create()
    const b = m.create()
    expect(m.switch(a.id)).toBe(true)
    expect(m.activeId).toBe(a.id)
    expect(m.switch(a.id)).toBe(false) // already active
    expect(m.switch('tab-99')).toBe(false) // unknown
    expect(m.activeId).toBe(a.id)
  })

  it('switch(null) unsets the active tab (no visible tab)', () => {
    const m = new BrowserTabManager()
    const a = m.create()
    expect(m.switch(null)).toBe(true)
    expect(m.activeId).toBeNull()
    expect(m.active).toBeNull()
    expect(m.list).toHaveLength(1) // tab still exists, just not active
    expect(m.switch(null)).toBe(false) // already unset
    expect(m.switch(a.id)).toBe(true) // and it can be re-activated
    expect(m.activeId).toBe(a.id)
  })

  it('closing a non-active tab keeps the active one', () => {
    const m = new BrowserTabManager()
    const a = m.create()
    const b = m.create()
    m.switch(a.id)
    const res = m.close(b.id)
    expect(res?.closed.id).toBe(b.id)
    expect(res?.nextActiveId).toBe(a.id)
    expect(m.count).toBe(1)
    expect(m.activeId).toBe(a.id)
  })

  it('closing the active tab activates the right neighbor, else the left', () => {
    const m = new BrowserTabManager()
    const a = m.create()
    const b = m.create()
    const c = m.create()
    // active = c; close it → right neighbor none → left neighbor b
    expect(m.close(c.id)?.nextActiveId).toBe(b.id)
    // active = b (after previous close); close it → right neighbor a
    expect(m.close(b.id)?.nextActiveId).toBe(a.id)
    expect(m.activeId).toBe(a.id)
    // close the last tab → nothing left
    expect(m.close(a.id)?.nextActiveId).toBeNull()
    expect(m.count).toBe(0)
    expect(m.activeId).toBeNull()
  })

  it('closing an unknown id returns null and changes nothing', () => {
    const m = new BrowserTabManager()
    m.create()
    expect(m.close('tab-404')).toBeNull()
    expect(m.count).toBe(1)
  })

  it('patch() updates mutable fields and rejects unknown ids', () => {
    const m = new BrowserTabManager()
    const t = m.create()
    expect(m.patch(t.id, { title: 'Docs', loading: true, canGoBack: true })).toBe(true)
    expect(m.getById(t.id)).toMatchObject({ title: 'Docs', loading: true, canGoBack: true })
    expect(m.patch('tab-404', { title: 'x' })).toBe(false)
  })

  it('list/getById return copies so callers cannot mutate internal state', () => {
    const m = new BrowserTabManager()
    const t = m.create()
    const snap = m.list[0]
    snap.title = 'mutated'
    expect(m.getById(t.id)?.title).toBe('')
  })

  it('clear() resets everything', () => {
    const m = new BrowserTabManager()
    m.create()
    m.create()
    m.clear()
    expect(m.count).toBe(0)
    expect(m.activeId).toBeNull()
    expect(m.list).toEqual([])
  })

  it('binds tabs to owner keys and finds them by owner (parallel browsing reuse)', () => {
    const m = new BrowserTabManager()
    const a = m.create({ url: 'https://a.dev' })
    const b = m.create({ owner: 'subagent:r1' })
    const c = m.create({ owner: 'session:s1' })
    expect(a.owner).toBeNull()
    expect(b.owner).toBe('subagent:r1')
    expect(c.owner).toBe('session:s1')

    // Reuse: the same owner resolves to the same tab instead of spawning anew.
    expect(m.findByOwner('subagent:r1')?.id).toBe(b.id)
    expect(m.findByOwner('session:s1')?.id).toBe(c.id)
    // Unknown / empty owners.
    expect(m.findByOwner('session:other')).toBeUndefined()
    expect(m.findByOwner(undefined)).toBeUndefined()
    expect(m.findByOwner('')).toBeUndefined()
    // Copies — mutating a find result must not touch internal state.
    const found = m.findByOwner('subagent:r1')
    if (found) found.url = 'mutated'
    expect(m.findByOwner('subagent:r1')?.url).toBe('')
  })
})
