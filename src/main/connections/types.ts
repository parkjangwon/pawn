export type ConnectionProvider = 'google' | 'github' | 'gitlab' | 'codecommit'

export type PatProvider = 'gitlab' | 'codecommit'

export interface StoredTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
  /** Display label (email / login) after a successful profile fetch. */
  accountLabel?: string
  updatedAt: number
  /** GitLab self-hosted base URL (e.g. https://gitlab.example.com). */
  baseUrl?: string
  /** AWS region for CodeCommit (e.g. ap-northeast-2). */
  region?: string
  /** AWS access key id for CodeCommit. */
  accessKeyId?: string
  /** Optional AWS session token (temporary credentials). */
  sessionToken?: string
}

export interface ConnectionStatus {
  provider: ConnectionProvider
  connected: boolean
  accountLabel?: string
  scope?: string
  /** Client ID configured (OAuth app registration). PAT providers are always true. */
  clientConfigured: boolean
  /** Auth style: oauth browser/device flow vs paste PAT/credentials. */
  authMode: 'oauth' | 'pat'
  updatedAt?: number
  /** Non-secret metadata shown in UI (GitLab host / AWS region). */
  hostHint?: string
}

export interface OAuthClientConfig {
  googleClientId?: string
  googleClientSecret?: string
  githubClientId?: string
  githubClientSecret?: string
}

export interface PatCredentials {
  /** GitLab personal access token, or CodeCommit secret access key. */
  token?: string
  /** GitLab base URL (required for gitlab). */
  baseUrl?: string
  /** AWS region (required for codecommit). */
  region?: string
  /** AWS access key id (required for codecommit). */
  accessKeyId?: string
  /** AWS secret access key (alias for token on codecommit). */
  secretAccessKey?: string
  /** Optional AWS session token. */
  sessionToken?: string
}

export const ALL_CONNECTION_PROVIDERS: ConnectionProvider[] = [
  'google',
  'github',
  'gitlab',
  'codecommit'
]

export const PAT_PROVIDERS: PatProvider[] = ['gitlab', 'codecommit']

export function isPatProvider(p: string): p is PatProvider {
  return p === 'gitlab' || p === 'codecommit'
}

export function isConnectionProvider(p: string): p is ConnectionProvider {
  return (
    p === 'google' || p === 'github' || p === 'gitlab' || p === 'codecommit'
  )
}
