import { session } from 'electron'
import { handleTrusted } from './trust'
import { connectCheck, probeUrl } from '../netProbe'

/** Renderer asks main to classify a transport failure Chromium only reports as "Failed to fetch". */
export function registerNetIpc(): void {
  handleTrusted('net:probe', async (_e, url: unknown) => {
    if (typeof url !== 'string') return { ok: false, code: 'EINVALIDURL' }
    return probeUrl(url)
  })

  // Connect-only: TCP plus TLS handshake. Does not wait for HTTP headers.
  handleTrusted('net:connectCheck', async (_e, url: unknown, timeoutMs: unknown) => {
    if (typeof url !== 'string' || typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, code: 'EINVAL' }
    }
    return connectCheck(url, timeoutMs, { resolveProxy: (u) => session.defaultSession.resolveProxy(u) })
  })
}
