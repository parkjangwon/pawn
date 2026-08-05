/**
 * Product OAuth clients for Pawn Desktop.
 *
 * Values are injected at build time via electron-vite `define` from:
 *   - process.env / .env (local dev)
 *   - GitHub Actions secrets (release builds)
 *
 * Never hardcode secrets in this file. Runtime overrides still work via
 * PAWN_* env vars or optional ~/.pawn/oauth-clients.json (no Settings UI).
 */
export type EmbeddedOAuth = {
  googleClientId: string
  googleClientSecret: string
  githubClientId: string
  githubClientSecret: string
}

const EMPTY: EmbeddedOAuth = {
  googleClientId: '',
  googleClientSecret: '',
  githubClientId: '',
  githubClientSecret: ''
}

function readBuildInjected(): EmbeddedOAuth {
  try {
    // Replaced by electron.vite.config.ts define → JSON object literal
    const v = __PAWN_OAUTH__
    if (v && typeof v === 'object') {
      return {
        googleClientId: String(v.googleClientId || ''),
        googleClientSecret: String(v.googleClientSecret || ''),
        githubClientId: String(v.githubClientId || ''),
        githubClientSecret: String(v.githubClientSecret || '')
      }
    }
  } catch {
    /* tsc / unit tests without define */
  }
  return EMPTY
}

export const EMBEDDED_OAUTH: EmbeddedOAuth = readBuildInjected()
