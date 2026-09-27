/**
 * Skill store (Settings → Skill store): pure helpers for sorting, paging and
 * formatting registry results. Data comes from window.api.skills (skills.sh).
 */

export type SkillSort = 'popular' | 'newest' | 'name'

export interface StoreSkill extends RegistrySkill {
  description?: string
  /** ISO date first seen on skills.sh */
  firstSeen?: string
}

export const PAGE_SIZE = 12

/**
 * Popular = most installs. Newest = most recently first seen (unknown dates
 * last, then by installs). Name = A→Z. Stable for equal keys.
 */
export function sortSkills(list: StoreSkill[], sort: SkillSort): StoreSkill[] {
  const out = [...list]
  if (sort === 'name') return out.sort((a, b) => a.name.localeCompare(b.name) || b.installs - a.installs)
  if (sort === 'newest') {
    return out.sort((a, b) => {
      if (a.firstSeen && b.firstSeen && a.firstSeen !== b.firstSeen) return a.firstSeen < b.firstSeen ? 1 : -1
      if (a.firstSeen && !b.firstSeen) return -1
      if (!a.firstSeen && b.firstSeen) return 1
      return b.installs - a.installs
    })
  }
  return out.sort((a, b) => b.installs - a.installs)
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

export function pageSlice<T>(list: T[], page: number, size = PAGE_SIZE): T[] {
  const p = Math.min(Math.max(1, page), pageCount(list.length, size))
  return list.slice((p - 1) * size, p * size)
}

/** Same skill listed from several repos (forks, mirrors): keep the most installed. */
export function dedupeByName(list: StoreSkill[]): StoreSkill[] {
  const best = new Map<string, StoreSkill>()
  for (const s of list) {
    const k = s.id.toLowerCase()
    const cur = best.get(k)
    if (!cur || s.installs > cur.installs) best.set(k, s)
  }
  return [...best.values()]
}

export function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}
