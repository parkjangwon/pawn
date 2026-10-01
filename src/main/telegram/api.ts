/**
 * Telegram Bot API over HTTPS. Long polling is the desktop default: a local
 * app has no public URL for a webhook (OpenClaw and Hermes do the same).
 * The token is a path segment and is stripped from every error string.
 */

export interface TelegramCallResult {
  ok: boolean
  errorCode?: number
  description?: string
  retryAfter?: number
  result?: unknown
}

export interface TelegramHttp {
  call: (
    token: string,
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<TelegramCallResult>
}

export function redactToken(token: string, text: string): string {
  if (!token) return text
  return text.split(token).join('***')
}

export function createTelegramHttp(fetchImpl: typeof fetch = fetch): TelegramHttp {
  return {
    async call(token, method, body, signal) {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      let json: {
        ok?: boolean
        error_code?: number
        description?: string
        result?: unknown
        parameters?: { retry_after?: number }
      }
      try {
        json = (await res.json()) as typeof json
      } catch {
        return { ok: false, errorCode: res.status, description: 'Telegram returned a non-JSON response.' }
      }
      if (!json.ok) {
        const description = redactToken(token, json.description || res.statusText || 'Telegram request failed.')
        if (/message is not modified/i.test(description)) {
          return { ok: true, result: json.result, description }
        }
        return {
          ok: false,
          errorCode: json.error_code || res.status,
          description,
          retryAfter: json.parameters?.retry_after
        }
      }
      return { ok: true, result: json.result }
    }
  }
}

export function messageIdOf(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined
  const id = (result as { message_id?: unknown }).message_id
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined
}
