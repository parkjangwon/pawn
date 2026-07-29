import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse, stringify } from 'smol-toml'

const PAWN_DIR = join(homedir(), '.pawn')
const CONFIG_PATH = join(PAWN_DIR, 'config.toml')

export interface ProviderConfig {
  id: string
  name: string
  apiFormat: string
  authMethod: string
  baseUrl: string
  apiKey?: string
  enabled: boolean
}

export interface ModelConfig {
  id: string
  providerId: string
  modelId: string
  label: string
  tier: string
  enabled: boolean
}

export interface PawnConfig {
  [key: string]: unknown
  settings?: {
    theme?: string
    language?: string
    routingMode?: string
    defaultSendMode?: string
  }
  providers?: ProviderConfig[]
  models?: ModelConfig[]
}

function ensureDir(): void {
  if (!existsSync(PAWN_DIR)) {
    mkdirSync(PAWN_DIR, { recursive: true })
  }
}

export function loadConfig(): PawnConfig {
  ensureDir()
  if (!existsSync(CONFIG_PATH)) {
    return { settings: {}, providers: [], models: [] }
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return parse(raw) as PawnConfig
  } catch {
    return { settings: {}, providers: [], models: [] }
  }
}

export function saveConfig(partial: PawnConfig): void {
  ensureDir()
  // Merge with existing config instead of overwriting
  const existing = loadConfig()
  const merged: PawnConfig = {
    ...existing,
    ...partial,
    settings: { ...existing.settings, ...partial.settings }
  }
  const raw = stringify(merged as Record<string, unknown>)
  writeFileSync(CONFIG_PATH, raw, 'utf-8')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getPawnDir(): string {
  return PAWN_DIR
}
