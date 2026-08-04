/**
 * Whether a renderer agent turn is in flight. Kept in its own module so
 * window.ts can guard against closing the window mid-task without creating an
 * import cycle through the IPC layer.
 */
let streaming = false

export function setAppStreaming(value: boolean): void {
  streaming = value
}

export function isAppStreaming(): boolean {
  return streaming
}
