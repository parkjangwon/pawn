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
    sleepPrevention?: string
    trayEnabled?: boolean
  }
  providers?: ProviderConfig[]
  models?: ModelConfig[]
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function loadConfig(dir = PAWN_DIR): PawnConfig {
  ensureDir(dir)
  const configPath = join(dir, 'config.toml')
  if (!existsSync(configPath)) {
    return { settings: {}, providers: [], models: [] }
  }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return parse(raw) as PawnConfig
  } catch {
    return { settings: {}, providers: [], models: [] }
  }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const key of Object.keys(b)) {
    const av = a[key]
    const bv = b[key]
    // Arrays are replaced wholesale (providers, models, etc.)
    if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) {
      out[key] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>)
    } else {
      out[key] = bv
    }
  }
  return out
}

export function saveConfig(partial: PawnConfig, dir = PAWN_DIR): void {
  ensureDir(dir)
  // Recursively merge: settings, and any future nested keys, merge safely.
  // Arrays (providers, models) are always passed in full and replace wholesale.
  const existing = loadConfig(dir)
  const merged = deepMerge(existing as Record<string, unknown>, partial as Record<string, unknown>) as PawnConfig
  const raw = stringify(merged as Record<string, unknown>)
  writeFileSync(join(dir, 'config.toml'), raw, 'utf-8')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getPawnDir(): string {
  return PAWN_DIR
}
