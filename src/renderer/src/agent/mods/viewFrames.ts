/** Live view iframes by `${plugin}\0${id}`, so `$.view.post` can reach them. */
const frames = new Map<string, Window>()

export function registerModViewFrame(plugin: string, id: string, win: Window | null): void {
  const key = `${plugin}\0${id}`
  if (win) frames.set(key, win)
  else frames.delete(key)
}

export function postToModView(plugin: string, id: string, data: unknown): boolean {
  const win = frames.get(`${plugin}\0${id}`)
  if (!win) return false
  let safe: unknown = null
  try {
    safe = data === undefined ? null : JSON.parse(JSON.stringify(data))
  } catch {
    throw new Error('view message must be JSON-serializable')
  }
  // Opaque-origin frame: targetOrigin must be '*'; the frame window itself is the target.
  win.postMessage({ __pawnView: 1, kind: 'message', data: safe }, '*')
  return true
}
