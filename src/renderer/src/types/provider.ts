export type ApiFormat = 'openai' | 'claude'
export type AuthMethod = 'api-key' | 'oauth'

export interface Provider {
  id: string
  name: string
  apiFormat: ApiFormat
  authMethod: AuthMethod
  baseUrl: string
  apiKey?: string
  oauthToken?: string
  enabled: boolean
}

export interface ModelEntry {
  id: string
  providerId: string
  modelId: string
  label: string
  tier: 'low' | 'mid' | 'high'
  enabled: boolean
}

export type RoutingMode = 'manual' | 'auto'

export interface ProviderConfig {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null
}
