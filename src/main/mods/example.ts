import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'

/**
 * The installed sample is kept byte-identical to examples/mods/first-mod so
 * the MODS.md walkthrough matches what "Install sample mod" produces.
 * modsExample.test.ts pins this.
 */
export const PLUGIN_JSON = `{
  "name": "first-mod",
  "version": "0.1.0",
  "description": "Counts tool calls, shows a band above the prompt, and adds /tally plus a ping tool",
  "author": { "name": "Pawn" }
}
`

export const HOOKS_JSON = `{
  "description": "The first-mod hooks module",
  "modules": ["./register.js"]
}
`

export const REGISTER_JS = `// The count, shared by the hooks below
let calls = 0
let note = ''

// Pawn / Claude Code calls this once when the mod loads
export function register(on) {
  // Runs when the session starts, before your first prompt
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tally',
      description: 'Show how many tool calls the agent has made'
    })
    await $.tool.register({
      name: 'ping',
      description: 'Reply pong. Use when the user asks this mod to ping.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => 'pong'
    })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Runs each time the agent is about to use a tool
  on('tool.call', async ($, e, next) => {
    calls += 1
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Runs when you type /tally
  on('command.run', { command: 'tally' }, async () => {
    return { text: 'The agent has made ' + calls + ' tool calls since this mod loaded' + (note ? ' · note: ' + note : '') }
  })

  // Interactive band above the composer
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const el = $.ui.resolve(e)
    return next({
      ...e,
      props: {
        ...e.props,
        plugin: $.plugin.name,
        tree: el.Box({
          children: [
            el.Text({ text: 'first-mod · tool calls: ' + calls + (note ? ' · ' + note : '') }),
            el.Button({ id: 'reset-tally', text: 'Reset count' }),
            el.Input({ id: 'note', placeholder: 'Optional note…', value: note })
          ]
        })
      }
    })
  })

  on('ui.press', { id: 'reset-tally' }, async ($, e) => {
    calls = 0
    $.ui.toast('Tally reset')
    $.ui.invalidate('ui.render')
    return e
  })

  on('ui.input', { id: 'note' }, async ($, e) => {
    note = String(e.value || '')
    $.ui.invalidate('ui.render')
    return e
  })

  // Runs each time the spinner is drawn
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
