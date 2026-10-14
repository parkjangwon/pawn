import { modNotification } from './mods/modelEvents'

/** Send a desktop notification and let mods observe it (`notification` event). */
export function pawnNotify(title: string, body: string, source?: string): Promise<void> {
  try {
    modNotification({ title, body, source })
  } catch {
    /* mods never block a notification */
  }
  const api = window.api?.notification
  if (!api?.send) return Promise.resolve()
  return Promise.resolve(api.send(title, body)).then(
    () => undefined,
    () => undefined
  )
}
