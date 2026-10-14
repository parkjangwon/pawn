import { net, type WebContents } from 'electron'
import { handleTrusted } from './trust'
import { loadConfig } from '../config'
import { runProviderRequest } from '../providerHttp'

/**
 * `providerHttp:start` sends a plain-http provider request from main (see
 * ../providerHttp.ts for the allowlist). The invoke resolves when the request
 * is finished; status, body chunks and the end are pushed on `providerHttp:event`
 * in order, keyed by the renderer's request id. `providerHttp:abort` cancels.
 */
const inflight = new Map<string, AbortController>()
const key = (sender: WebContents, id: string): string => `${sender.id}:${id}`

export function registerProviderHttpIpc(): void {
  handleTrusted('providerHttp:start', async (e, id: unknown, req: unknown) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, error: 'bad id' }
    const sender = e.sender
    const k = key(sender, id)
    inflight.get(k)?.abort()
    const ctl = new AbortController()
    inflight.set(k, ctl)
    const send = (evt: Record<string, unknown>): void => {
      if (!sender.isDestroyed()) sender.send('providerHttp:event', id, evt)
    }
    const onGone = (): void => ctl.abort()
    sender.once('destroyed', onGone)
    let failed: string | null = null
    try {
      await runProviderRequest(req, ctl.signal, {
        providers: () => (loadConfig().providers || []) as Array<{ baseUrl?: unknown }>,
        fetch: (url, init) => net.fetch(url, { ...init, bypassCustomProtocolHandlers: true })
      }, {
        head: (status, statusText, headers) => send({ type: 'head', status, statusText, headers }),
        chunk: (data) => send({ type: 'chunk', data }),
        end: () => send({ type: 'end' }),
        error: (message) => { failed = message; send({ type: 'error', message }) }
      })
    } finally {
      inflight.delete(k)
      if (!sender.isDestroyed()) sender.removeListener('destroyed', onGone)
    }
    return failed ? { ok: false, error: failed } : { ok: true }
  })

  handleTrusted('providerHttp:abort', async (e, id: unknown) => {
    if (typeof id !== 'string') return { ok: false }
    inflight.get(key(e.sender, id))?.abort()
    return { ok: true }
  })
}

export function disposeProviderHttp(): void {
  inflight.forEach((c) => c.abort())
  inflight.clear()
}
