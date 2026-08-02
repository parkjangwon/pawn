import { describe, it, expect, beforeEach } from 'vitest'
import { useStreamingStore } from '../streaming'

beforeEach(() => {
  useStreamingStore.setState({ content: {} })
})

describe('streaming store', () => {
  it('stores live text per message id', () => {
    useStreamingStore.getState().setContent('m1', 'hello')
    useStreamingStore.getState().setContent('m2', 'world')
    expect(useStreamingStore.getState().content).toEqual({ m1: 'hello', m2: 'world' })
  })

  it('replaces and clears entries without touching others', () => {
    useStreamingStore.getState().setContent('m1', 'a')
    useStreamingStore.getState().setContent('m1', 'ab')
    useStreamingStore.getState().setContent('m2', 'x')
    useStreamingStore.getState().clear('m1')
    expect(useStreamingStore.getState().content).toEqual({ m2: 'x' })
  })

  it('clearing an unknown id is a no-op', () => {
    useStreamingStore.getState().clear('missing')
    expect(useStreamingStore.getState().content).toEqual({})
  })
})
