// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '../../i18n'
import KiroAuthPanel from '../KiroAuthPanel'

let loginDone: ((d: { ok: boolean; error?: string }) => void) | null = null
let signedIn = false

beforeEach(() => {
  signedIn = false
  ;(window as any).api = {
    kiro: {
      status: vi.fn(async () => (signedIn ? { signedIn: true, mode: 'builder-id', provider: 'AWS Builder ID', region: 'us-east-1' } : { signedIn: false })),
      usage: vi.fn(async () => ({ ok: true, usage: { used: 12, limit: 1000 } })),
      startLogin: vi.fn(async () => ({ ok: true, userCode: 'WXYZ-1234', verificationUri: 'https://device.sso.aws', verificationUriComplete: 'https://device.sso.aws/?code=WXYZ', expiresIn: 600 })),
      cancelLogin: vi.fn(async () => ({ ok: true })),
      signOut: vi.fn(async () => ({ ok: true })),
      importLogin: vi.fn(async () => ({ ok: false, error: 'No Kiro CLI or IDE login found.' })),
      setApiKey: vi.fn(async () => ({ ok: true })),
      onLoginDone: (cb: typeof loginDone) => {
        loginDone = cb
        return () => (loginDone = null)
      }
    }
  }
})

describe('KiroAuthPanel', () => {
  it('runs the Builder ID device flow and reports the signed-in account with credits', async () => {
    const onSignedIn = vi.fn()
    render(<KiroAuthPanel onSignedIn={onSignedIn} />)
    fireEvent.click(await screen.findByRole('button', { name: /Builder ID/ }))
    expect(await screen.findByText('WXYZ-1234')).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://device.sso.aws/?code=WXYZ')
    signedIn = true
    await act(async () => loginDone?.({ ok: true }))
    await waitFor(() => expect(screen.getByText(/Signed in to Kiro via AWS Builder ID/)).toBeTruthy())
    expect(screen.getByText(/12 \/ 1000 credits used/)).toBeTruthy()
    expect(onSignedIn).toHaveBeenCalled()
  })

  it('shows import errors and takes an API key', async () => {
    render(<KiroAuthPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Kiro CLI/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('No Kiro CLI or IDE login found')
    fireEvent.click(screen.getByRole('button', { name: /API key/ }))
    fireEvent.change(screen.getByPlaceholderText('ksk_…'), { target: { value: 'ksk_abcdefghijk' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect((window as any).api.kiro.setApiKey).toHaveBeenCalledWith('ksk_abcdefghijk', 'us-east-1'))
  })
})
