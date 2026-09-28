/**
 * Apply a subscription access token when one is signed in.
 * ChatGPT and Antigravity replace the request body (see subscriptionWire).
 * Claude replaces the API key on api.anthropic.com until sign-out, same as xAI.
 * The refresh token never leaves the main process.
 */

import { applyXaiSession } from './xaiSession'
import { authHeadersForChat, providerChatUrl } from './testProvider'
import {
  isAntigravityBase,
  isChatGptCodexBase,
  isClaudeApiBase,
  rewriteSubscriptionCall,
  type SubscriptionAuth
} from './subscriptionWire'

export type { SubscriptionAuth }

export async function applyProviderAuth<T extends { baseUrl?: string; apiKey?: string }>(
  provider: T
): Promise<T & { subscription?: SubscriptionAuth }> {
  const next = await applyXaiSession(provider)
  if (isChatGptCodexBase(next.baseUrl)) {
    const got = await window.api?.chatgpt?.accessToken?.()?.catch?.(() => null)
    if (got?.ok && got.token) {
      return { ...next, apiKey: got.token, subscription: { kind: 'chatgpt', accountId: got.accountId } }
    }
  } else if (isClaudeApiBase(next.baseUrl)) {
    const got = await window.api?.claudeOauth?.accessToken?.()?.catch?.(() => null)
    if (got?.ok && got.token) {
      return { ...next, apiKey: got.token, subscription: { kind: 'claude' } }
    }
  } else if (isAntigravityBase(next.baseUrl)) {
    const got = await window.api?.antigravity?.accessToken?.()?.catch?.(() => null)
    if (got?.ok && got.token) {
      return { ...next, apiKey: got.token, subscription: { kind: 'antigravity', projectId: got.projectId } }
    }
  }
  return next
}

/** One-shot (non-stream) call with subscription auth and the right wire format. */
export async function prepareSideCall(
  provider: { baseUrl: string; apiKey?: string; apiFormat: 'openai' | 'claude' | 'kiro' },
  body: Record<string, unknown>
): Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> {
  const authed = await applyProviderAuth(provider)
  return rewriteSubscriptionCall({
    provider: authed,
    url: providerChatUrl(authed),
    headers: authHeadersForChat(authed),
    body,
    stream: false
  })
}
