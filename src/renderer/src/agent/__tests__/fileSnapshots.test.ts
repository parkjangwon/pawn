import { describe, it, expect, beforeEach } from 'vitest'
import {
  __resetFileSnapshotsForTests,
  checkStale,
  fingerprint,
  forgetFile,
  noteFileSeen,
  snapshotScope
} from '../fileSnapshots'

beforeEach(() => __resetFileSnapshotsForTests())

describe('fileSnapshots', () => {
  it('fingerprints are stable and content-sensitive', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'))
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'))
    expect(fingerprint('')).not.toBe(fingerprint(' '))
  })

  it('reports unknown / fresh / stale', () => {
    const scope = snapshotScope({ sessionId: 's' })
    expect(checkStale(scope, '/a.ts', 'x')).toBe('unknown')
    noteFileSeen(scope, '/a.ts', 'x')
    expect(checkStale(scope, '/a.ts', 'x')).toBe('fresh')
    expect(checkStale(scope, '/a.ts', 'y')).toBe('stale')
    forgetFile(scope, '/a.ts')
    expect(checkStale(scope, '/a.ts', 'y')).toBe('unknown')
  })

  it('normalizes Windows separators and isolates subagent scopes', () => {
    const session = snapshotScope({ sessionId: 's' })
    const sub = snapshotScope({ sessionId: 's', subagentRunId: 'r1' })
    expect(sub).not.toBe(session)
    noteFileSeen(session, 'C:\\p\\a.ts', 'x')
    expect(checkStale(session, 'C:/p/a.ts', 'x')).toBe('fresh')
    expect(checkStale(sub, 'C:/p/a.ts', 'x')).toBe('unknown')
  })
})
