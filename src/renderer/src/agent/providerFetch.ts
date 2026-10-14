import { whenProviderSavesSettled } from '../stores/provider'

/**
 * Plain-http provider URLs (LAN Ollama, a local mock on 127.0.0.1, a self-hosted
 * gateway) are fetched by main, which allows only origins of currently saved
 * providers. The page's CSP was fixed at load, so this is how a provider added
 * or edited after launch works without a reload. Everything else (https, browser
 * mode, no bridge) uses the normal fetch.
 */
type Bridge = NonNullable<Window['api']>['providerHttp']

let seq = 0

function bridge(): Bridge | undefined {
  try {
    return (window as unknown as { api?: { providerHttp?: Bridge } }).api?.providerHttp
  } catch {
    return undefined
  }
}

function isPlainHttp(url: string): boolean {
  try {
    return new URL(url).protocol === 'http:'
  } catch {
    return false
  }
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  new Headers(h).forEach((v, k) => { out[k] = v })
  return out
}

function abortError(signal?: AbortSignal | null): unknown {
  const r = signal?.reason
  if (r instanceof Error || (typeof DOMException !== 'undefined' && r instanceof DOMException)) return r
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function providerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const api = bridge()
  // Not async on this path: callers race the returned promise against a
  // connect check, so native fetch must not gain an extra tick.
  if (!api || !isPlainHttp(url)) return fetch(url, init)
  return viaMain(api, url, init)
}

async function viaMain(api: Bridge, url: string, init: RequestInit): Promise<Response> {
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    throw new TypeError('providerFetch: only string bodies are supported for http providers')
  }
  const signal = init.signal ?? undefined
  if (signal?.aborted) throw abortError(signal)
  // A provider saved a moment ago must be on disk before main checks the list.
  await whenProviderSavesSettled()
  if (signal?.aborted) throw abortError(signal)

  const id = `pf${Date.now().toString(36)}${(++seq).toString(36)}`
  return new Promise<Response>((resolve, reject) => {
    let headSeen = false
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const pending: Uint8Array[] = []
    let ended = false
    let failure: unknown = null

    const onAbort = (): void => {
      void api.abort(id).catch(() => {})
      const err = abortError(signal)
      if (!headSeen) reject(err)
      else if (controller) { try { controller.error(err) } catch { /* closed */ } }
      else failure = err
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)

    api.start(
      id,
      { url, method: init.method || 'GET', headers: headerRecord(init.headers), body: (init.body as string | undefined) ?? undefined },
      (evt) => {
        if (evt.type === 'head') {
          headSeen = true
          const nullBody = [101, 204, 205, 304].includes(evt.status)
          const body = nullBody
            ? null
            : new ReadableStream<Uint8Array>({
                start(c) {
                  controller = c
                  for (const p of pending) c.enqueue(p)
                  pending.length = 0
                  if (failure) c.error(failure)
                  else if (ended) c.close()
                },
                cancel() {
                  void api.abort(id).catch(() => {})
                  cleanup()
                }
              })
          // Response forbids status < 200; main only forwards real HTTP statuses.
          resolve(new Response(body, { status: evt.status < 200 ? 502 : evt.status, statusText: evt.statusText, headers: evt.headers }))
        } else if (evt.type === 'chunk') {
          const data = evt.data instanceof Uint8Array ? evt.data : new Uint8Array(evt.data as ArrayBufferLike)
          if (controller) { try { controller.enqueue(data) } catch { /* closed */ } } else pending.push(data)
        } else if (evt.type === 'end') {
          ended = true
          cleanup()
          if (controller) { try { controller.close() } catch { /* closed */ } }
        } else if (evt.type === 'error') {
          cleanup()
          const err = signal?.aborted ? abortError(signal) : new TypeError('Failed to fetch', { cause: new Error(evt.message) })
          if (!headSeen) reject(err)
          else if (controller) { try { controller.error(err) } catch { /* closed */ } }
          else failure = err
        }
      }
    ).then((r) => {
      // Refused or failed before any event (e.g. bad id): surface it.
      if (!headSeen && r && r.ok === false) {
        cleanup()
        reject(signal?.aborted ? abortError(signal) : new TypeError('Failed to fetch', { cause: new Error(r.error || 'request failed') }))
      }
    }, (e) => {
      cleanup()
      if (!headSeen) reject(new TypeError('Failed to fetch', { cause: e }))
    })
  })
}
