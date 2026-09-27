// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '../../i18n'
import DecisionModelsSettingsPanel from '../DecisionModelsSettingsPanel'
import { useDecisionStore } from '../../stores/decision'

const features = { agentTool: true, shellRiskGuard: true, routerAssist: false }
let status: DecisionStatusDto

beforeEach(() => {
  status = { providers: [], active: null, features: { ...features } }
  useDecisionStore.setState({ status: null, fetchedAt: 0, available: true })
  ;(window as any).api = {
    decision: {
      status: vi.fn(async () => status),
      saveProvider: vi.fn(async (input: Record<string, unknown>) => {
        const p: DecisionProviderDto = {
          id: 'dp-new',
          kind: input.kind as DecisionProviderKindDto,
          name: 'TypeSafe',
          baseUrl: String(input.baseUrl),
          model: String(input.model),
          enabled: true,
          hasKey: !!input.apiKey,
          keyHint: '…1234',
          local: false
        }
        status = { providers: [p], active: p, features: status.features }
        return { ok: true, id: p.id, status }
      }),
      test: vi.fn(async () => ({
        ok: true,
        model: 'jev-1.13.0',
        latencyMs: 212,
        answers: { is_request: { type: 'noul', noul: 0.97 } },
        provider: { id: 'dp-new', name: 'TypeSafe', kind: 'typesafe', local: false }
      })),
      setFeatures: vi.fn(async (partial: Partial<DecisionFeaturesDto>) => {
        status = { ...status, features: { ...status.features, ...partial } }
        return { ok: true, status }
      }),
      setEnabled: vi.fn(),
      removeProvider: vi.fn(),
      models: vi.fn(async () => ({ ok: true, models: [] }))
    }
  }
})

describe('DecisionModelsSettingsPanel', () => {
  it('starts empty and optional, with the harness switches disabled', async () => {
    render(<DecisionModelsSettingsPanel />)
    expect(await screen.findByText(/No decision model yet/)).toBeTruthy()
    expect(screen.getByText(/Turn on a decision model above/)).toBeTruthy()
    const toggle = screen.getByRole('checkbox', { name: 'Check commands before they run' }) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
  })

  it('adds TypeSafe with a key, tests it, and enables the harness switches', async () => {
    render(<DecisionModelsSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /^TypeSafe/ }))
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://api.typesafe.ai')
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('jev-latest')
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: 'ts-secret-1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add and test' }))

    await waitFor(() =>
      expect((window as any).api.decision.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'typesafe', baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', apiKey: 'ts-secret-1234' })
      )
    )
    expect(await screen.findByText(/Works · jev-1.13.0 · answered in 212 ms/)).toBeTruthy()
    expect(screen.getByText('In use')).toBeTruthy()
    // The key never comes back to the UI, only a hint.
    expect(document.body.textContent).not.toContain('ts-secret-1234')

    const routing = screen.getByRole('checkbox', { name: 'Judge request difficulty (for auto routing)' }) as HTMLInputElement
    expect(routing.disabled).toBe(false)
    expect(routing.checked).toBe(false)
    fireEvent.click(routing)
    await waitFor(() => expect((window as any).api.decision.setFeatures).toHaveBeenCalledWith({ routerAssist: true }))
  })

  it('prefills Ollaya for a local server without a key', async () => {
    render(<DecisionModelsSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /^Ollaya/ }))
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('http://localhost:11435')
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('laya')
    expect((screen.getByLabelText(/API key/) as HTMLInputElement).required).toBe(false)
    expect(screen.getByText(/Nothing goes to a cloud service/)).toBeTruthy()
  })
})
