import type { ToolDefinition } from '../toolDefinitionsTypes'

export const SKILL_TOOLS: ToolDefinition[] = [
  {
    name: 'save_skill',
    description:
      'Save or update a reusable user skill at ~/.agents/skills/<name>/SKILL.md (shared with other agents). ' +
      'Use when the user asks to create a skill or to change one — e.g. refining a skill drafted from a recorded workflow. ' +
      '`content` is the complete SKILL.md: YAML front matter with `name` (same as the name argument) and `description` (when to use it), ' +
      'then Inputs / Before you start / Steps / Verify / Notes. Show the full revised SKILL.md to the user in a ````skill block in your reply as well. ' +
      'Set overwrite:true only to replace a skill the user asked you to change.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'kebab-case skill name (a-z, 0-9, -; max 64)' },
        content: { type: 'string', description: 'Full SKILL.md text including front matter' },
        overwrite: { type: 'boolean', description: 'Replace an existing skill with this name' }
      },
      required: ['name', 'content']
    }
  }
]
