/**
 * When an xAI provider is signed in, the OAuth access token replaces the pasted
 * API key for that request. Signing out falls back to the key.
 * The refresh token never leaves the main process.
 */
export function isXaiHost(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).hostname.toLowerCase()
    return host === 'api.x.ai'
  } catch {
    return false
  }
}

export async function applyXaiSession<T extends { baseUrl?: string; apiKey?: string }>(provider: T): Promise<T> {
  if (!isXaiHost(provider.baseUrl)) return provider
  const got = await window.api?.xai?.accessToken?.().catch(() => null)
  if (got?.ok && got.token) return { ...provider, apiKey: got.token }
  return provider
}
