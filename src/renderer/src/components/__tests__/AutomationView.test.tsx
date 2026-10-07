// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))

import AutomationView from '../AutomationView'
import { useRoutineStore } from '../../stores/routine'
import { openAutomationDraft } from '../../stores/automationDraft'

const add = vi.fn(async () => ({ ok: true }))

beforeEach(() => {
  add.mockClear()
  useRoutineStore.setState({ routines: [], runningIds: new Set(), add, refresh: vi.fn(async () => {}) } as any)
})

function renderView(): void {
  render(<AutomationView onToggleSidebar={() => {}} canGoBack={false} canGoForward={false} onGoBack={() => {}} onGoForward={() => {}} />)
}

describe('AutomationView — Repeat this handoff', () => {
  it('opens the editor prefilled as "every weekday 09:00" and saves it as weekday cron', async () => {
    openAutomationDraft({ prompt: 'Summarize AI news with links' })
    renderView()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    // Name (input) and task (textarea) both come from the chat prompt.
    expect(screen.getAllByDisplayValue('Summarize AI news with links').map((el) => el.tagName).sort()).toEqual(['INPUT', 'TEXTAREA'])
    const when = screen.getByDisplayValue('Every weekday') as HTMLSelectElement
    expect(when.value).toBe('weekdays')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(add).toHaveBeenCalledTimes(1)
    const arg = (add.mock.calls[0] as unknown as [{ name: string; schedule: { type: string; expr?: string } }])[0]
    expect(arg.name).toBe('Summarize AI news with links')
    expect(arg.schedule).toMatchObject({ type: 'cron', expr: '0 9 * * 1-5' })
  })
})
