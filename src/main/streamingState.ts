/**
 * Whether any renderer agent turn is in flight. Multi-session aware:
 * each session can stream independently; the window close/quit guards
 * only care if the set is non-empty.
 */
const streamingSessions = new Set<string>()

/** Legacy boolean path still used by a few call sites; prefer session APIs. */
export function setAppStreaming(value: boolean): void {
  if (value) {
    if (streamingSessions.size === 0) streamingSessions.add('__legacy__')
  } else {
    streamingSessions.clear()
  }
}

export function setSessionStreaming(sessionId: string, streaming: boolean): void {
  if (!sessionId) return
  if (streaming) {
    streamingSessions.add(sessionId)
    if (sessionId !== '__legacy__') streamingSessions.delete('__legacy__')
  } else {
    streamingSessions.delete(sessionId)
  }
}

export function clearAllStreaming(): void {
  streamingSessions.clear()
}

export function isAppStreaming(): boolean {
  return streamingSessions.size > 0
}

export function streamingSessionCount(): number {
  return streamingSessions.size
}
