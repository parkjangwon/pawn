// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import SystemSettingsPanel, { currentVersionPrefix } from '../SystemSettingsPanel'

const noop = (): void => {}
const state = {
  sleepPrevention: 'off', setSleepPrevention: noop,
  taskNotificationsEnabled: true, setTaskNotificationsEnabled: noop,
  trayVisible: true, setTrayVisible: noop,
  confirmQuit: true, setConfirmQuit: noop,
  checkUpdatesOnLaunch: true, setCheckUpdatesOnLaunch: noop,
  updateMsg: '', setUpdateMsg: noop,
  updateChecking: false, setUpdateChecking: noop
}

describe('currentVersionPrefix', () => {
  it('labels real versions and hides stand-ins', () => {
    expect(currentVersionPrefix('3.2.4')).toBe('Current version v3.2.4 · ')
    expect(currentVersionPrefix('v3.2.4-beta.1')).toBe('Current version v3.2.4-beta.1 · ')
    expect(currentVersionPrefix('web')).toBe('')
    expect(currentVersionPrefix('headless')).toBe('')
    expect(currentVersionPrefix('')).toBe('')
  })
})

describe('SystemSettingsPanel', () => {
  beforeEach(() => {
    ;(window as any).api = { appVersion: async () => '3.2.4' }
  })

  it('shows the current version in the Check for updates row', async () => {
    render(<SystemSettingsPanel state={state as never} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText(/Current version v3\.2\.4 · Compare this build with the latest GitHub release/)).toBeInTheDocument()
  })

  it('sleep prevention stays a segmented control', () => {
    render(<SystemSettingsPanel state={state as never} />)
    expect(screen.getByRole('group', { name: 'Sleep prevention' }).className).toContain('theme-toggle')
  })
})
