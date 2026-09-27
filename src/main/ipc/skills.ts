import { handleTrusted } from './trust'
import { installRegistrySkill, listUserSkills, removeUserSkill, searchRegistry, skillDetails } from '../skillRegistry'

/** Settings → Skills: browse skills.sh, install to / remove from ~/.agents/skills. */
export function registerSkillsIpc(): void {
  handleTrusted('skills:search', async (_e, query: unknown) => searchRegistry(typeof query === 'string' ? query.slice(0, 100) : ''))
  handleTrusted('skills:details', async (_e, id: unknown) => skillDetails(typeof id === 'string' ? id : ''))
  handleTrusted('skills:install', async (_e, id: unknown) => installRegistrySkill(typeof id === 'string' ? id : ''))
  handleTrusted('skills:remove', async (_e, name: unknown) => removeUserSkill(typeof name === 'string' ? name : ''))
  handleTrusted('skills:installed', async () => listUserSkills())
}
