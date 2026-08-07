import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useStreamingStore, __flushStreamingForTests } from '../streaming'

beforeEach(() => {
  useStreamingStore.setState({ content: {} })
  __flushStreamingForTests()
})

afterEach(() => {
  __flushStreamingForTests()
})

describe('streaming store', () => {
  it('stores live text per message id (coalesced via rAF flush)', () => {
    useStreamingStore.getState().setContent('m1', 'hello')
    useStreamingStore.getState().setContent('m2', 'world')
    __flushStreamingForTests()
    expect(useStreamingStore.getState().content).toEqual({ m1: 'hello', m2: 'world' })
  })

  it('replaces and clears entries without touching others', () => {
    useStreamingStore.getState().setContent('m1', 'a')
    __flushStreamingForTests()
    useStreamingStore.getState().setContent('m1', 'ab')
    __flushStreamingForTests()
    useStreamingStore.getState().setContent('m2', 'x')
    __flushStreamingForTests()
    useStreamingStore.getState().clear('m1')
    expect(useStreamingStore.getState().content).toEqual({ m2: 'x' })
  })

  it('clearing an unknown id is a no-op', () => {
    useStreamingStore.getState().clear('missing')
    expect(useStreamingStore.getState().content).toEqual({})
  })

  it('setContentNow writes immediately without waiting for rAF', () => {
    useStreamingStore.getState().setContentNow('m1', 'instant')
    expect(useStreamingStore.getState().content.m1).toBe('instant')
  })

  it('coalesces multiple setContent calls before flush', () => {
    useStreamingStore.getState().setContent('m1', 'a')
    useStreamingStore.getState().setContent('m1', 'ab')
    useStreamingStore.getState().setContent('m1', 'abc')
    // Not flushed yet — may still be empty or partial depending on rAF mock
    __flushStreamingForTests()
    expect(useStreamingStore.getState().content.m1).toBe('abc')
  })

  it('clearAll drops everything', () => {
    useStreamingStore.getState().setContentNow('m1', 'x')
    useStreamingStore.getState().setContentNow('m2', 'y')
    useStreamingStore.getState().clearAll()
    expect(useStreamingStore.getState().content).toEqual({})
  })
})
