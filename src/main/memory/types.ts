/** Long-term agent memory — durable local knowledge cards. */

export type MemoryScope = 'user' | 'project'
export type MemoryKind =
  | 'preference'
  | 'fact'
  | 'procedure'
  | 'project'
  | 'person'
  | 'decision'
  | 'other'

export type MemorySource = 'user' | 'agent' | 'auto' | 'import'

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  projectId: string | null
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  source: MemorySource
  confidence: number
  pinned: boolean
  enabled: boolean
  hitCount: number
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export interface MemorySearchHit extends MemoryRecord {
  score: number
  why: string
}

export interface MemorySettings {
  /** Master switch — tools + injection + auto-capture */
  enabled: boolean
  /** After each agent turn, extract durable cards heuristically */
  autoCapture: boolean
  /** Inject top matching memories into turn preamble */
  injectOnTurn: boolean
  /** Max memories injected per turn */
  injectLimit: number
  /** Max chars for injected block */
  injectMaxChars: number
  /** When true, only store if confidence ≥ threshold after redaction */
  requireMinConfidence: number
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  autoCapture: true,
  injectOnTurn: true,
  injectLimit: 8,
  injectMaxChars: 3500,
  requireMinConfidence: 0.45
}

export interface MemorySaveInput {
  content: string
  title?: string
  kind?: MemoryKind
  scope?: MemoryScope
  projectId?: string | null
  tags?: string[]
  source?: MemorySource
  confidence?: number
  pinned?: boolean
}

export interface MemorySearchInput {
  query: string
  projectId?: string | null
  kind?: MemoryKind
  scope?: MemoryScope
  limit?: number
  includeDisabled?: boolean
}

export interface MemoryListInput {
  projectId?: string | null
  kind?: MemoryKind
  scope?: MemoryScope
  limit?: number
  offset?: number
  query?: string
}

export interface TurnIngestInput {
  projectId?: string | null
  sessionId?: string
  messages: Array<{ role: string; content: string }>
}
