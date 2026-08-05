/**
 * GitLab (self-hosted or gitlab.com) connection via Personal Access Token.
 */

import { loadTokens, saveTokens, clearTokens } from './store'
import type { PatCredentials, StoredTokens } from './types'

const UA = 'Pawn-Desktop'

export function normalizeGitlabBaseUrl(raw: string): string | null {
  let s = (raw || '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // strip trailing slash and accidental /api/v4
    let path = u.pathname.replace(/\/+$/, '')
    if (path.endsWith('/api/v4')) path = path.slice(0, -'/api/v4'.length)
    path = path.replace(/\/+$/, '')
    return `${u.origin}${path}`
  } catch {
    return null
  }
}

export function getGitlabAccessToken(): string | null {
  return loadTokens('gitlab')?.accessToken || null
}

export function getGitlabBaseUrl(): string | null {
  return loadTokens('gitlab')?.baseUrl || null
}

export function getGitlabConfig(): { token: string; baseUrl: string } | null {
  const t = loadTokens('gitlab')
  if (!t?.accessToken || !t.baseUrl) return null
  return { token: t.accessToken, baseUrl: t.baseUrl }
}

export async function connectGitlab(creds: PatCredentials): Promise<{
  ok?: boolean
  error?: string
  accountLabel?: string
}> {
  const baseUrl = normalizeGitlabBaseUrl(creds.baseUrl || '')
  if (!baseUrl) {
    return { error: 'GitLab base URL is required (e.g. https://gitlab.example.com)' }
  }
  const token = (creds.token || '').trim()
  if (!token) {
    return { error: 'GitLab personal access token is required' }
  }

  try {
    const res = await fetch(`${baseUrl}/api/v4/user`, {
      headers: {
        'PRIVATE-TOKEN': token,
        Accept: 'application/json',
        'User-Agent': UA
      }
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = text.slice(0, 200)
      try {
        const j = JSON.parse(text) as { message?: string; error?: string }
        detail = j.message || j.error || detail
      } catch { /* keep text */ }
      if (res.status === 401 || res.status === 403) {
        return { error: `GitLab auth failed (${res.status}): check PAT and scopes (api / read_api)` }
      }
      return { error: `GitLab connection failed (${res.status}): ${detail || res.statusText}` }
    }
    const user = (await res.json()) as {
      username?: string
      name?: string
      email?: string
      web_url?: string
    }
    const accountLabel = user.username || user.name || user.email || 'GitLab user'
    const tokens: StoredTokens = {
      accessToken: token,
      baseUrl,
      tokenType: 'pat',
      scope: 'api',
      accountLabel: `${accountLabel} @ ${new URL(baseUrl).host}`,
      updatedAt: Date.now()
    }
    saveTokens('gitlab', tokens)
    return { ok: true, accountLabel: tokens.accountLabel }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function disconnectGitlab(): void {
  clearTokens('gitlab')
}
