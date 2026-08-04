/**
 * Renderer-side bridge to the embedded browser (an Electron WebContentsView owned
 * by the main process). This is the one object both the agent tools (tools.ts)
 * and the UI panel (BrowserView.tsx) talk to, so the two never fight over
 * navigation state — the main process is the single source of truth and this
 * module just calls its IPC surface.
 *
 * Only available in the Electron build: `window.api.platform !== 'browser'` and
 * the browser IPC methods exist. In dev:web mode there is no native view to
 * drive, so getBrowserAgent() returns null and the tools report that plainly
 * instead of silently no-op'ing against a sandboxed iframe.
 */

export interface BrowserAgent {
  ensure: () => Promise<{ error?: string }>
  navigate: (url: string) => Promise<{ url?: string; title?: string; error?: string }>
  snapshot: (filter: string) => Promise<{
    url: string; title: string
    elements: Array<{ ref: string; role: string; text: string; name: string; placeholder: string; value: string; href: string }>
    truncated: boolean
    error?: string
  }>
  click: (ref: string, selector: string) => Promise<{ message: string; error?: string }>
  fill: (ref: string, selector: string, value: string, submit: boolean) => Promise<{ message: string; error?: string }>
  readText: (selector: string) => Promise<{ text: string; error?: string }>
  evaluate: (code: string) => Promise<{ result: string; error?: string }>
  back: () => Promise<{ url?: string; error?: string }>
  screenshot: () => Promise<{ bytes: number; dataUrl?: string; error?: string }>
}

let cached: BrowserAgent | null | undefined

export function getBrowserAgent(): BrowserAgent | null {
  if (cached !== undefined) return cached

  const api = window.api
  const isElectron = !!api && api.platform !== 'browser' && !!api.browser?.ensure
  if (!isElectron) {
    cached = null
    return cached
  }

  cached = {
    ensure: async () => {
      const res = await api.browser.ensure()
      return res.error ? { error: res.error } : {}
    },
    navigate: async (url) => {
      const res = await api.browser.navigate(url)
      if (res.error) return { error: res.error }
      return { url: res.url, title: res.title }
    },
    snapshot: async (filter) => {
      const res = await api.browser.snapshot(filter)
      if (res.error) return { url: '', title: '', elements: [], truncated: false, error: res.error }
      return {
        url: res.url || '',
        title: res.title || '',
        elements: res.elements || [],
        truncated: res.truncated === true
      }
    },
    click: async (ref, selector) => {
      const res = await api.browser.click(ref, selector)
      return res.error ? { message: '', error: res.error } : { message: res.message || 'Clicked' }
    },
    fill: async (ref, selector, value, submit) => {
      const res = await api.browser.fill(ref, selector, value, submit)
      return res.error ? { message: '', error: res.error } : { message: res.message || 'Filled' }
    },
    readText: async (selector) => {
      const res = await api.browser.readText(selector)
      return res.error ? { text: '', error: res.error } : { text: res.text || '' }
    },
    evaluate: async (code) => {
      const res = await api.browser.eval(code)
      return res.error ? { result: '', error: res.error } : { result: res.result ?? 'undefined' }
    },
    back: async () => {
      const res = await api.browser.back()
      return res.error ? { error: res.error } : { url: res.url }
    },
    screenshot: async () => {
      const res = await api.browser.screenshot()
      if (res.error) return { bytes: 0, error: res.error }
      return { bytes: res.bytes || 0, dataUrl: res.dataUrl }
    }
  }
  return cached
}
