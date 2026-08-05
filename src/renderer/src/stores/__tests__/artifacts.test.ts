// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useArtifactsStore } from '../artifacts'

beforeEach(() => {
  useArtifactsStore.setState({ items: [] })
})

describe('useArtifactsStore', () => {
  it('prepends items and caps history', () => {
    for (let i = 0; i < 90; i++) {
      useArtifactsStore.getState().add({ title: `t${i}`, kind: 'note', preview: 'x' })
    }
    const items = useArtifactsStore.getState().items
    expect(items.length).toBe(80)
    expect(items[0].title).toBe('t89')
  })

  it('removes by id', () => {
    const a = useArtifactsStore.getState().add({ title: 'a', kind: 'file', path: '/tmp/a' })
    useArtifactsStore.getState().add({ title: 'b', kind: 'report' })
    useArtifactsStore.getState().remove(a.id)
    expect(useArtifactsStore.getState().items.map((x) => x.title)).toEqual(['b'])
  })
})
