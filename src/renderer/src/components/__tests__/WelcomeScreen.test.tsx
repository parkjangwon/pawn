// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import WelcomeScreen, { getGreetingKey } from '../WelcomeScreen'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => (vars?.name ? `${key}:${vars.name}` : key) })
}))

vi.mock('../../stores/provider', () => ({
  useProviderStore: () => []
}))

vi.mock('../../stores/app', () => ({
  useAppStore: () => []
}))

describe('getGreetingKey', () => {
  it('maps all 24 hours onto the six segments', () => {
    const expected: Record<number, string> = {
      0: 'night', 1: 'night', 2: 'night', 3: 'night', 4: 'night',
      5: 'dawn', 6: 'dawn',
      7: 'morning', 8: 'morning', 9: 'morning', 10: 'morning',
      11: 'midday', 12: 'midday', 13: 'midday',
      14: 'afternoon', 15: 'afternoon', 16: 'afternoon', 17: 'afternoon',
      18: 'evening', 19: 'evening', 20: 'evening', 21: 'evening', 22: 'evening',
      23: 'night'
    }
    for (const [hour, seg] of Object.entries(expected)) {
      expect(getGreetingKey(Number(hour))).toBe(`chat.greeting.${seg}`)
    }
  })
})

describe('WelcomeScreen', () => {
  it('renders the pawn logo, a time-aware greeting and four home cards', () => {
    render(
      <WelcomeScreen
        activeProject={undefined}
        onPick={() => {}}
        onOpenSettings={() => {}}
      />
    )
    expect(document.querySelector('.welcome-logo svg')).toBeTruthy()
    expect(document.querySelector('.welcome-greeting')?.textContent).toMatch(/^chat\.greeting\./)
    expect(screen.getByText('chat.home.codeTitle')).toBeTruthy()
    expect(screen.getByText('chat.home.browseTitle')).toBeTruthy()
    expect(screen.getByText('chat.home.computerTitle')).toBeTruthy()
    expect(screen.getByText('chat.home.autoTitle')).toBeTruthy()
    expect(screen.getByText('chat.home.codeDesc')).toBeTruthy()
  })
})
