/** Per-plugin JSON key-value store shared across sessions (localStorage). */

const PREFIX = 'pawn-mod-store:'

function storageKey(plugin: string, key: string): string {
  return `${PREFIX}${plugin}:${key}`
}

function indexKey(plugin: string): string {
  return `${PREFIX}${plugin}::__keys__`
}

function readIndex(plugin: string): string[] {
  try {
    const raw = localStorage.getItem(indexKey(plugin))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeIndex(plugin: string, keys: string[]): void {
  try {
    localStorage.setItem(indexKey(plugin), JSON.stringify([...new Set(keys)]))
  } catch {
    /* quota */
  }
}

export const modKvStore = {
  async get(plugin: string, key: string): Promise<unknown> {
    try {
      const raw = localStorage.getItem(storageKey(plugin, key))
      if (raw == null) return undefined
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  },
  async set(plugin: string, key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value)
    if (json.length > 4 * 1024 * 1024) throw new Error('$.store value exceeds 4 MiB')
    localStorage.setItem(storageKey(plugin, key), json)
    const keys = readIndex(plugin)
    if (!keys.includes(key)) writeIndex(plugin, [...keys, key])
  },
  async delete(plugin: string, key: string): Promise<void> {
    localStorage.removeItem(storageKey(plugin, key))
    writeIndex(
      plugin,
      readIndex(plugin).filter((k) => k !== key)
    )
  },
  async keys(plugin: string): Promise<string[]> {
    return readIndex(plugin)
  }
}
