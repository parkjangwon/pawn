// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { nameFromPrompt, openAutomationDraft, useAutomationDraftStore } from '../automationDraft'

describe('Repeat this → automation draft', () => {
  it('names the automation from the first line of the prompt', () => {
    expect(nameFromPrompt('\n  Summarize today\'s AI news  \nwith links')).toBe("Summarize today's AI news")
    expect(nameFromPrompt('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`)
  })

  it('stores the draft once and asks the app to open Automations', () => {
    const onOpen = vi.fn()
    window.addEventListener('pawn:open-automations', onOpen)
    openAutomationDraft({ prompt: '매일 아침 뉴스 요약해 줘', projectId: 'demo' })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(useAutomationDraftStore.getState().take()).toEqual({ prompt: '매일 아침 뉴스 요약해 줘', projectId: 'demo', name: '매일 아침 뉴스 요약해 줘' })
    // Consumed: a second view mount doesn't reopen it.
    expect(useAutomationDraftStore.getState().take()).toBeNull()
    window.removeEventListener('pawn:open-automations', onOpen)
  })
})
