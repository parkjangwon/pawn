import { handleTrusted } from './trust'
import { probeUrl } from '../netProbe'

/** Renderer asks main to classify a transport failure Chromium only reports as "Failed to fetch". */
export function registerNetIpc(): void {
  handleTrusted('net:probe', async (_e, url: unknown) => {
    if (typeof url !== 'string') return { ok: false, code: 'EINVALIDURL' }
    return probeUrl(url)
  })
}
