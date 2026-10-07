import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { wikiRoot } from './paths'
import { DEFAULT_WIKI_SETTINGS, type WikiSettings } from './types'

function settingsFile(): string {
  return join(wikiRoot(), 'settings.json')
}

export function getWikiSettings(): WikiSettings {
  const file = settingsFile()
  if (!existsSync(file)) return { ...DEFAULT_WIKI_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<WikiSettings>
    return { ...DEFAULT_WIKI_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_WIKI_SETTINGS }
  }
}

export function setWikiSettings(partial: Partial<WikiSettings>): WikiSettings {
  const next: WikiSettings = { ...getWikiSettings(), ...partial }
  next.injectMaxChars = Math.min(Math.max(next.injectMaxChars || 4000, 500), 20_000)
  next.logTail = Math.min(Math.max(next.logTail ?? 5, 0), 20)
  try {
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch {
    /* best-effort */
  }
  return next
}
