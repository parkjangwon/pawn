import { getBrowserAgent, type BrowserAgent } from '../browser'

export async function requireBrowser(): Promise<{ agent: BrowserAgent } | { error: string }> {
  const agent = getBrowserAgent()
  if (!agent) {
    return { error: 'The embedded browser is only available in the desktop app.' }
  }
  const ready = await agent.ensure()
  if (ready.error) return { error: ready.error }
  try {
    ;(window as any).__openRightPanelTab?.('browser')
  } catch {
    // No panel bridge (e.g. dev:web)
  }
  return { agent }
}
