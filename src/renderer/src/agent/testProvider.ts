/**
 * Provider connection probe used by Settings → Test.
 *
 * Must call a model the provider actually serves. Hardcoding gpt-4o-mini /
 * claude-3-haiku fails with 400 on OpenCode Go, Command Code, DeepSeek, MiMo, etc.
 */

import type { ApiFormat, ModelEntry, Provider } from '../types/provider'

export function normalizeProviderBaseUrl(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '')
}

export function providerChatUrl(provider: Pick<Provider, 'apiFormat' | 'baseUrl'>): string {
  const base = normalizeProviderBaseUrl(provider.baseUrl)
  if (provider.apiFormat === 'claude') {
    return base.endsWith('/messages') ? base : `${base}/messages`
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** Prefer an enabled model registered under this provider; fall back to any attached model. */
export function pickTestModelId(
  providerId: string,
  models: Array<Pick<ModelEntry, 'providerId' | 'modelId' | 'enabled'>>,
  apiFormat: ApiFormat
): string | null {
  const mine = models.filter((m) => m.providerId === providerId && m.modelId.trim())
  const enabled = mine.find((m) => m.enabled)
  if (enabled) return enabled.modelId
  if (mine[0]) return mine[0].modelId
  // Last-resort fallbacks only for true OpenAI/Anthropic hosts with no models yet.
  return apiFormat === 'claude' ? 'claude-haiku-4-5' : 'gpt-5.6-luna'
}

export function authHeadersForChat(
  provider: Pick<Provider, 'apiFormat' | 'baseUrl' | 'apiKey'>
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = (provider.apiKey || '').trim()
  if (provider.apiFormat === 'claude') {
    if (token) {
      headers['x-api-key'] = token
      headers['anthropic-version'] = '2023-06-01'
    }
  } else if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (token && /xiaomimimo\.com/i.test(provider.baseUrl || '')) {
    headers['api-key'] = token
  }
  return headers
}

export function buildTestRequestBody(
  apiFormat: ApiFormat,
  modelId: string
): Record<string, unknown> {
  if (apiFormat === 'claude') {
    return {
      model: modelId,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'ping' }]
    }
  }
  return {
    model: modelId,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'ping' }]
  }
}

/** Pull a short human-readable reason from common provider error JSON shapes. */
export function summarizeProviderError(status: number, bodyText: string): string {
  const raw = (bodyText || '').trim()
  let detail = ''
  if (raw) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>
      const err = j.error
      if (typeof err === 'string') detail = err
      else if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>
        detail = String(e.message || e.type || e.code || '')
      }
      if (!detail && typeof j.message === 'string') detail = j.message
      if (!detail && typeof j.type === 'string') detail = j.type
    } catch {
      detail = raw.replace(/\s+/g, ' ')
    }
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 80)
  return detail ? `FAIL: ${status} — ${detail}` : `FAIL: ${status}`
}
