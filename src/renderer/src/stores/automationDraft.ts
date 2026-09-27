/**
 * "Repeat this" → a prefilled automation draft. The chat hands the draft over
 * here, switches to the Automations view, and the view opens its editor with
 * it (the view may not be mounted yet when the button is pressed).
 */
import { create } from 'zustand'

export interface AutomationDraftSeed {
  prompt: string
  projectId?: string
  name?: string
}

interface AutomationDraftState {
  pending: AutomationDraftSeed | null
  take: () => AutomationDraftSeed | null
}

export const useAutomationDraftStore = create<AutomationDraftState>((set, get) => ({
  pending: null,
  take: () => {
    const p = get().pending
    if (p) set({ pending: null })
    return p
  }
}))

/** A short automation name from the prompt: first line, trimmed to ~40 chars. */
export function nameFromPrompt(prompt: string): string {
  const line = prompt.split('\n').map((l) => l.trim()).find(Boolean) || ''
  return line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line
}

export function openAutomationDraft(seed: AutomationDraftSeed): void {
  useAutomationDraftStore.setState({ pending: { ...seed, name: seed.name || nameFromPrompt(seed.prompt) } })
  window.dispatchEvent(new CustomEvent('pawn:open-automations'))
}
