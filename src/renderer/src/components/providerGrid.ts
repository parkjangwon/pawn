/**
 * Pure helpers for the Settings → Providers tile grid: grouping, search and
 * the "already registered" check. Grouping only reads existing preset metadata.
 */
import type { ProviderPreset } from '../agent/providerPresets'

export type PresetGroupId = 'cloud' | 'plan' | 'local'

export const PRESET_GROUPS: Array<{ id: PresetGroupId; label: string; hint: string }> = [
  { id: 'cloud', label: 'Cloud APIs', hint: 'Paste an API key' },
  { id: 'plan', label: 'Coding plans & subscriptions', hint: 'Sign in or use a plan key' },
  { id: 'local', label: 'Local', hint: 'Runs on your machine, no key' }
]

/** A plan/subscription key, named in the preset itself (Token Plan, "subscribe Go", Provider plan). */
function isPlanKey(p: ProviderPreset): boolean {
  return /\bplan\b/i.test(p.name) || /subscribe|provider plan/i.test(p.keyHint)
}

function isPlanLike(p: ProviderPreset): boolean {
  return Boolean(p.signIn || p.skipCatalogSync || isPlanKey(p))
}

/** local = localNoKey; plan = signs in / plan key (or shares a base URL with a plan key); otherwise cloud. */
export function presetGroup(preset: ProviderPreset, all: ProviderPreset[]): PresetGroupId {
  if (preset.localNoKey) return 'local'
  if (isPlanLike(preset)) return 'plan'
  // Sibling wire formats of a plan key (OpenCode Go (Anthropic)) share its base URL.
  // Sign-in rows don't count: Anthropic's API shares a base URL with Claude sign-in.
  if (all.some((o) => o !== preset && o.baseUrl === preset.baseUrl && isPlanKey(o))) return 'plan'
  return 'cloud'
}

export function matchesPresetQuery(preset: ProviderPreset, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [preset.name, preset.id, preset.baseUrl].some((s) => s.toLowerCase().includes(q))
}

export function groupPresets(
  presets: ProviderPreset[],
  query = ''
): Array<{ id: PresetGroupId; label: string; hint: string; items: ProviderPreset[] }> {
  return PRESET_GROUPS.map((g) => ({
    ...g,
    items: presets.filter((p) => presetGroup(p, presets) === g.id && matchesPresetQuery(p, query))
  })).filter((g) => g.items.length > 0)
}

/** Same rule the panel has always used: a provider with the same name (case-insensitive). */
export function isPresetRegistered(preset: { name: string }, providers: Array<{ name: string }>): boolean {
  return providers.some((p) => p.name.toLowerCase() === preset.name.toLowerCase())
}

/** Two-letter mark: initials of the first two words, ignoring parentheses ("Moonshot AI (Kimi)" → "MA", "OpenRouter" → "OR"). */
export function providerInitials(name: string): string {
  const words = name.replace(/\(.*?\)/g, ' ').split(/[\s\-_/.]+/).filter((w) => /[A-Za-z0-9]/.test(w))
  if (words.length === 0) return '?'
  if (words.length === 1) {
    const w = words[0].replace(/[^A-Za-z0-9]/g, '')
    // CamelCase brand (OpenRouter, DeepSeek): first two capitals.
    const caps = w.match(/[A-Z]/g) || []
    if (/^[A-Z]/.test(w) && caps.length >= 2) return caps[0] + caps[1]
    return (w.slice(0, 1).toUpperCase() + (w.slice(1, 2) || '')).slice(0, 2) || '?'
  }
  return (words[0][0] + words[1][0]).toUpperCase()
}
