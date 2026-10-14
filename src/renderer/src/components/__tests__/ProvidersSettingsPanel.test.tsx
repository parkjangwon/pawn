// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ProvidersSettingsPanel from '../ProvidersSettingsPanel'
import { groupPresets, isPresetRegistered, matchesPresetQuery, presetGroup, providerInitials } from '../providerGrid'
import { PROVIDER_PRESETS } from '../../agent/providerPresets'
import type { SettingsState } from '../settingsState'

const byId = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id)!

describe('provider grid helpers', () => {
  it('groups presets into cloud / coding plan / local from preset metadata', () => {
    const g = (id: string) => presetGroup(byId(id), PROVIDER_PRESETS)
    expect(g('ollama')).toBe('local')
    expect(g('lmstudio')).toBe('local')
    expect(g('kiro')).toBe('plan')
    expect(g('chatgpt')).toBe('plan')
    expect(g('antigravity')).toBe('plan')
    expect(g('dashscope')).toBe('plan')
    expect(g('opencode-go')).toBe('plan')
    expect(g('opencode-go-anthropic')).toBe('plan')
    expect(g('claude')).toBe('plan')
    expect(g('anthropic')).toBe('cloud')
    expect(g('openai')).toBe('cloud')
    expect(g('openrouter')).toBe('cloud')
    expect(g('deepseek')).toBe('cloud')
    const groups = groupPresets(PROVIDER_PRESETS)
    expect(groups.map((x) => x.id)).toEqual(['cloud', 'plan', 'local'])
    expect(groups.reduce((n, x) => n + x.items.length, 0)).toBe(PROVIDER_PRESETS.length)
  })

  it('filters by name, id or base URL and drops empty groups', () => {
    expect(matchesPresetQuery(byId('groq'), 'GRO')).toBe(true)
    expect(matchesPresetQuery(byId('groq'), 'api.groq.com')).toBe(true)
    expect(matchesPresetQuery(byId('groq'), 'kimi')).toBe(false)
    const deep = groupPresets(PROVIDER_PRESETS, 'deep')
    expect(deep.map((x) => x.id)).toEqual(['cloud'])
    expect(deep[0].items.map((p) => p.id)).toEqual(['deepseek', 'deepseek-anthropic'])
    expect(groupPresets(PROVIDER_PRESETS, 'zzz-nothing')).toEqual([])
  })

  it('treats a provider with the same name (any case) as registered', () => {
    expect(isPresetRegistered({ name: 'OpenRouter' }, [{ name: 'openrouter' }])).toBe(true)
    expect(isPresetRegistered({ name: 'OpenRouter' }, [{ name: 'OpenAI' }])).toBe(false)
  })

  it('makes two-letter initials as the icon fallback', () => {
    expect(providerInitials('OpenRouter')).toBe('OR')
    expect(providerInitials('Groq')).toBe('Gr')
    expect(providerInitials('Moonshot AI (Kimi)')).toBe('MA')
    expect(providerInitials('Google (Gemini)')).toBe('Go')
    expect(providerInitials('LM Studio (local)')).toBe('LS')
    expect(providerInitials('xAI (Grok)')).toBe('XA')
    expect(providerInitials('  ')).toBe('?')
  })
})

function makeState(over: Partial<SettingsState> = {}): SettingsState {
  const fn = () => vi.fn()
  return {
    providers: [
      { id: 'p1', name: 'OpenRouter', apiFormat: 'openai', baseUrl: 'https://openrouter.ai/api/v1', enabled: true },
      { id: 'p2', name: 'Groq', apiFormat: 'openai', baseUrl: 'https://api.groq.com/openai/v1', enabled: false }
    ],
    syncResult: { p2: 'Synced 8 models' },
    syncFailed: {},
    handleSyncModels: fn(),
    syncingId: null,
    testResult: { p1: { ok: true, message: '' } },
    handleTestProvider: fn(),
    testingId: null,
    updateProvider: fn(),
    setConfirmDelete: fn(),
    setPresetPicking: fn(),
    setPresetKey: fn(),
    presetPicking: null,
    presetKey: '',
    presetKeyError: '',
    setPresetKeyError: fn(),
    ollamaUrl: 'http://localhost:11434',
    setOllamaUrl: fn(),
    formError: '',
    setFormError: fn(),
    handleAddFromPreset: fn(),
    showAddProvider: false,
    form: { name: '', apiFormat: 'openai', baseUrl: '', apiKey: '' },
    setForm: fn(),
    handleAddProvider: fn(),
    setShowAddProvider: fn(),
    ...over
  } as unknown as SettingsState
}

describe('ProvidersSettingsPanel', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {}
  })
  afterEach(() => cleanup())

  it('renders one card per provider with status, meta and the same actions wired', () => {
    const state = makeState()
    render(<ProvidersSettingsPanel state={state} />)
    const or = screen.getByRole('region', { name: 'OpenRouter' })
    expect(within(or).getByTestId('provider-status')).toHaveTextContent('Connected')
    expect(within(or).getByText('✓ Connected')).toBeTruthy()
    expect(within(or).getByRole('button', { name: 'Manual add only' })).toBeDisabled()
    fireEvent.click(within(or).getByRole('button', { name: 'Test connection' }))
    expect(state.handleTestProvider).toHaveBeenCalledWith('p1')
    fireEvent.click(within(or).getByRole('button', { name: 'Delete: OpenRouter' }))
    expect(state.setConfirmDelete).toHaveBeenCalledWith({ type: 'provider', id: 'p1', name: 'OpenRouter' })
    fireEvent.click(within(or).getByRole('switch', { name: 'Enable OpenRouter' }))
    expect(state.updateProvider).toHaveBeenCalledWith('p1', { enabled: false })

    const groq = screen.getByRole('region', { name: 'Groq' })
    expect(within(groq).getByText('Synced 8 models')).toHaveClass('provider-card-meta')
    fireEvent.click(within(groq).getByRole('button', { name: 'Sync models' }))
    expect(state.handleSyncModels).toHaveBeenCalledWith('p2')
  })

  it('shows Loading… while testing or syncing, like before', () => {
    render(<ProvidersSettingsPanel state={makeState({ testingId: 'p2', syncingId: 'p2' } as Partial<SettingsState>)} />)
    const groq = screen.getByRole('region', { name: 'Groq' })
    expect(within(groq).getAllByRole('button', { name: 'Loading…' })).toHaveLength(2)
  })

  it('tile grid: groups, registered check, search, and picking a preset', () => {
    const state = makeState()
    render(<ProvidersSettingsPanel state={state} />)
    expect(document.querySelectorAll('.provider-group')).toHaveLength(3)
    const orTile = screen.getAllByRole('button', { name: /OpenRouter/ }).find((b) => b.classList.contains('provider-tile'))!
    expect(orTile).toBeDisabled()
    expect(within(orTile).getByTestId('provider-registered')).toBeTruthy()
    expect(within(orTile).getByTestId('provider-mark')).toHaveTextContent('OR')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search providers' }), { target: { value: 'local' } })
    const tiles = [...document.querySelectorAll('.provider-tile')].map((t) => t.textContent)
    expect(tiles).toEqual(['OlOllama (local)', 'LSLM Studio (local)'])
    fireEvent.click(screen.getByRole('button', { name: /Ollama \(local\)/ }))
    expect(state.setPresetPicking).toHaveBeenCalledWith(expect.objectContaining({ id: 'ollama' }))
    expect(state.setPresetKey).toHaveBeenCalledWith('')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search providers' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No providers match “zzz”')).toBeTruthy()
  })

  it('preset form keeps the masked key field and Add/Cancel behavior', () => {
    const state = makeState({ presetPicking: byId('groq'), presetKey: 'k' } as Partial<SettingsState>)
    render(<ProvidersSettingsPanel state={state} />)
    const key = screen.getByPlaceholderText('Paste your API key')
    expect(key).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: /^Add \(includes/ }))
    expect(state.handleAddFromPreset).toHaveBeenCalledWith(byId('groq'), 'k')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(state.setPresetPicking).toHaveBeenCalledWith(null)
  })

  it('Add custom provider is a dashed card that opens the same form', () => {
    const state = makeState()
    const { rerender } = render(<ProvidersSettingsPanel state={state} />)
    const add = screen.getByRole('button', { name: 'Add custom provider' })
    expect(add).toHaveClass('provider-add-custom')
    fireEvent.click(add)
    expect(state.setShowAddProvider).toHaveBeenCalledWith(true)
    const open = makeState({ showAddProvider: true } as Partial<SettingsState>)
    rerender(<ProvidersSettingsPanel state={open} />)
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
    expect(open.handleAddProvider).toHaveBeenCalled()
    expect(screen.getByPlaceholderText('sk-…')).toHaveAttribute('type', 'password')
  })
})
