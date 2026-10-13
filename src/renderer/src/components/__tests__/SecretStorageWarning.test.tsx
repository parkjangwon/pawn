// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { usePlaintextSecretStorage } from '../ProvidersSettingsPanel'

function Probe(): React.JSX.Element {
  return <span>{usePlaintextSecretStorage() ? 'plaintext' : 'sealed'}</span>
}

const setApi = (status: { encrypted: boolean; reason?: string } | null): void => {
  ;(window as unknown as { api: unknown }).api = status
    ? { config: { secretStorageStatus: async () => status } }
    : {}
}

afterEach(() => cleanup())

describe('usePlaintextSecretStorage', () => {
  it('flags plaintext storage reported by main', async () => {
    setApi({ encrypted: false, reason: 'unavailable' })
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('plaintext')).toBeTruthy())
  })

  it('stays quiet when keys are encrypted or the channel is missing', async () => {
    setApi({ encrypted: true })
    render(<Probe />)
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('sealed')).toBeTruthy()
    cleanup()
    setApi(null)
    render(<Probe />)
    expect(screen.getByText('sealed')).toBeTruthy()
  })
})
