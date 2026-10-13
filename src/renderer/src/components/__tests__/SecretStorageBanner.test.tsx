// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SecretStorageWarningBanner } from '../ProvidersSettingsPanel'

afterEach(() => cleanup())

describe('SecretStorageWarningBanner', () => {
  it('renders a warning status banner', () => {
    render(<SecretStorageWarningBanner />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('data-testid', 'secret-storage-warning')
    expect(screen.getByText('API keys are stored unencrypted')).toBeTruthy()
    expect(banner.querySelector('.settings-warning-banner-body')?.textContent).toContain('restart')
    expect(banner.className).toContain('settings-warning-banner')
    expect(banner.className).not.toContain('settings-form-error')
  })
})
