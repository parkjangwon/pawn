// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { EN } from '../../i18n/strings'
import { deriveModCapabilities, type ModCapabilityId } from '../../agent/mods/capabilities'
import ModsConsentDialog, { type ModsConsentPreview } from '../ModsConsentDialog'

const preview: ModsConsentPreview = {
  name: 'first-mod',
  version: '1.2.3',
  ok: true,
  hooks: ['tool.call', 'ui.render'],
  calls: ['$.fs.read', '$.process.exec'],
  findings: []
}

describe('ModsConsentDialog', () => {
  it('renders the confirm dialog, meta, and one capability row per derived cap', () => {
    render(<ModsConsentDialog preview={preview} onCancel={() => {}} onConfirm={() => {}} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.classList.contains('confirm-dialog')).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Allow “first-mod”?' })).toBeInTheDocument()

    const meta = dialog.querySelector('.mods-consent-meta')
    expect(meta).not.toBeNull()
    expect(meta).toHaveTextContent('Version 1.2.3')
    expect(meta?.querySelector('.mods-version')).toHaveTextContent('Version 1.2.3')
    expect(meta?.querySelector('.mods-risk')).toHaveTextContent('Higher risk')

    const rows = dialog.querySelectorAll('.mods-cap-row')
    expect(Array.from(rows).map((row) => row.getAttribute('data-cap'))).toEqual([
      'tools',
      'files',
      'process',
      'ui'
    ])
    expect(rows[0].querySelector('.mods-cap-label')).toHaveTextContent('Intercept tools')
    expect(rows[0].querySelector('.mods-cap-desc')).toHaveTextContent('Can see, block, or answer tool calls.')
    expect(rows[1].querySelector('.mods-cap-desc')).toHaveTextContent('Can read and change files on disk.')
    expect(rows[2].querySelector('.mods-cap-desc')).toHaveTextContent('Can run shell commands on this computer.')
    expect(rows[3].querySelector('.mods-cap-desc')).toHaveTextContent('Can draw bands and controls above the composer.')

    const actions = within(dialog.querySelector('.confirm-actions') as HTMLElement)
    const cancel = actions.getByRole('button', { name: 'Cancel' })
    const allow = actions.getByRole('button', { name: 'Allow and enable' })
    expect(cancel.className).toContain('pawn-btn')
    expect(cancel.className).toContain('pawn-btn-outline')
    expect(allow.className).toContain('pawn-btn')
    expect(allow.className).toContain('pawn-btn-default')
    expect(allow).toBeEnabled()
  })

  it('disables confirm when the preview is not ok', () => {
    render(
      <ModsConsentDialog preview={{ ...preview, ok: false }} onCancel={() => {}} onConfirm={() => {}} />
    )
    expect(screen.getByRole('button', { name: 'Allow and enable' })).toBeDisabled()
  })

  it('cancels on Escape and Cancel', () => {
    const onCancel = vi.fn()
    render(<ModsConsentDialog preview={preview} onCancel={onCancel} onConfirm={() => {}} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('keeps an empty capability list as a muted line', () => {
    render(
      <ModsConsentDialog
        preview={{ ...preview, hooks: [], calls: [] }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )
    expect(document.querySelector('.mods-cap-row')).toBeNull()
    expect(document.querySelector('.mods-cap-empty')).toHaveTextContent('No special capabilities detected')
  })
})

describe('mod capability descriptions', () => {
  const caps: Record<ModCapabilityId, true> = {
    tools: true,
    files: true,
    process: true,
    network: true,
    commands: true,
    ui: true,
    sidebar: true,
    toolbar: true,
    settingsPage: true,
    statusbar: true,
    palette: true,
    shortcuts: true,
    messages: true,
    theme: true,
    views: true,
    modelRequests: true,
    modelResponses: true,
    notifications: true,
    subagents: true,
    providers: true,
    prompt: true,
    store: true
  }

  it('gives every capability a descKey whose string exists', () => {
    const derived = deriveModCapabilities(
      ['tool.x', 'fs.x', 'process.x', 'http.x', 'command.x', 'ui.x', 'message.render', 'model.request', 'model.response', 'Notification', 'prompt.x'],
      ['$.tool.call', '$.fs.read', '$.process.exec', '$.http.get', '$.command.add', '$.ui.toast', '$.slot.sidebar', '$.slot.toolbar', '$.slot.settings', '$.slot.statusbar', '$.slot.palette', '$.slot.shortcut', '$.theme.vars', '$.view.open', '$.agent.register', '$.provider.register', '$.prompt.set', '$.store.get'],
    )
    expect(derived.map((cap) => cap.id)).toEqual(Object.keys(caps))
    for (const cap of derived) {
      expect(cap.descKey).toBe(`settings.modsSection.capDesc.${cap.id}`)
      expect(EN[cap.descKey]).toBeTruthy()
      expect(EN[cap.labelKey]).toBeTruthy()
    }
  })
})

describe('messages capability risk', () => {
  it('rates a mod that only reads messages as medium risk', async () => {
    const { deriveModRisk } = await import('../../agent/mods/capabilities')
    expect(deriveModRisk(['message.render'], [])).toBe('medium')
    expect(deriveModRisk(['message.render'], ['$.http.fetch'])).toBe('high')
  })

  it('shows Medium risk and the message-text description in the dialog', () => {
    render(
      <ModsConsentDialog
        preview={{ name: 'msg-mod', version: '0.1.0', ok: true, hooks: ['message.render'], calls: [], findings: [] }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('.mods-risk')).toHaveTextContent(EN['settings.modsSection.risk.medium'])
    const row = dialog.querySelector('.mods-cap-row[data-cap="messages"]')
    expect(row?.querySelector('.mods-cap-desc')).toHaveTextContent('Reads the text of finished messages')
  })
})
