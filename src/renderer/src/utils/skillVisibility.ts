const DISABLED_SKILLS_KEY = 'pawn-disabled-skills'

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

export function loadDisabledSkillNames(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_SKILLS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string').map(normalize))
  } catch {
    return new Set()
  }
}

export function saveDisabledSkillNames(names: Set<string>): void {
  try {
    localStorage.setItem(DISABLED_SKILLS_KEY, JSON.stringify([...names]))
  } catch {
    // Best-effort local preference only.
  }
}

export function setSkillEnabled(skillName: string, enabled: boolean): Set<string> {
  const key = normalize(skillName)
  const next = loadDisabledSkillNames()
  if (enabled) next.delete(key)
  else next.add(key)
  saveDisabledSkillNames(next)
  return next
}

export function isSkillEnabled(skillName: string, disabledNames?: Set<string>): boolean {
  const disabled = disabledNames || loadDisabledSkillNames()
  return !disabled.has(normalize(skillName))
}

export function filterEnabledSkills<T extends { name: string }>(skills: T[], disabledNames?: Set<string>): T[] {
  const disabled = disabledNames || loadDisabledSkillNames()
  return skills.filter((s) => isSkillEnabled(s.name, disabled))
}

