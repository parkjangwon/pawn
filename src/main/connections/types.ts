export type ConnectionProvider = 'google' | 'github'

export interface StoredTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
  /** Display label (email / login) after a successful profile fetch. */
  accountLabel?: string
  updatedAt: number
}

export interface ConnectionStatus {
  provider: ConnectionProvider
  connected: boolean
  accountLabel?: string
  scope?: string
  /** Client ID configured (app registration present). */
  clientConfigured: boolean
  updatedAt?: number
}

export interface OAuthClientConfig {
  googleClientId?: string
  googleClientSecret?: string
  githubClientId?: string
  githubClientSecret?: string
}
