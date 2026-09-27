import type { ToolHandler } from './types'
import { clearProjectContextCache } from '../skills'

const save_skill: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.localSkills?.save) {
    return { toolCallId: call.id, content: 'Saving skills is only available in the desktop app.', isError: true }
  }
  const name = String(call.arguments.name || '').trim()
  const content = String(call.arguments.content || '')
  const r = await api.localSkills.save(name, content, { overwrite: call.arguments.overwrite === true })
  if (!r.ok) {
    const hint = r.exists ? ' Ask the user before replacing it, then call again with overwrite:true.' : ''
    return { toolCallId: call.id, content: `Could not save skill: ${r.error}.${hint}`, isError: true }
  }
  clearProjectContextCache()
  try {
    window.dispatchEvent(new Event('pawn:skills-changed'))
  } catch {
    /* headless */
  }
  return {
    toolCallId: call.id,
    content: `${r.created ? 'Created' : 'Updated'} skill "${name}" at ${r.path}. The user can run it with /${name} or ask you to use it.`
  }
}

export const skillHandlers: Record<string, ToolHandler> = { save_skill }
