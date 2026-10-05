import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'

const PLUGIN_JSON = `{
  "name": "first-mod",
  "version": "0.1.0",
  "description": "Counts tool calls, shows the count beside the spinner, and adds a /tally command",
  "author": { "name": "Pawn" }
}
`

const HOOKS_JSON = `{
  "description": "The first-mod hooks module",
  "modules": ["./register.js"]
}
`

const REGISTER_JS = `// The count, shared by the hooks below
let calls = 0

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tally',
      description: 'Show how many tool calls the agent has made'
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    calls += 1
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'tally' }, async () => {
    return { text: 'The agent has made ' + calls + ' tool calls since this mod loaded' }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    return next({ ...e, props: { ...e.props, suffix: ' · tool calls: ' + calls + '…' } })
  })
}
`

/** Install the bundled first-mod sample under ~/.pawn/mods/first-mod. */
export function installExampleMod(): { ok: boolean; path?: string; error?: string; existed?: boolean } {
  const root = join(getPawnDir(), 'mods', 'first-mod')
  const existed = existsSync(join(root, 'hooks', 'register.js'))
  try {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true })
    mkdirSync(join(root, 'hooks'), { recursive: true })
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), PLUGIN_JSON, 'utf-8')
    writeFileSync(join(root, 'hooks', 'hooks.json'), HOOKS_JSON, 'utf-8')
    writeFileSync(join(root, 'hooks', 'register.js'), REGISTER_JS, 'utf-8')
    return { ok: true, path: root, existed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
