// Palettes for the whole app. Only `--name` custom properties are accepted.
const PALETTES = {
  forest: {
    light: { '--accent': '#2f6b3a', '--primary': '#2f6b3a', '--bg-sidebar': '#eef3ec' },
    dark: { '--accent': '#8fd19e', '--primary': '#8fd19e', '--bg-sidebar': '#121a14' }
  },
  dusk: {
    light: { '--accent': '#6b3fa0', '--primary': '#6b3fa0', '--bg-sidebar': '#f3eef8' },
    dark: { '--accent': '#c3a6ff', '--primary': '#c3a6ff', '--bg-sidebar': '#17121f' }
  }
}
let current = 'forest'

// Each $.theme / $.slot call is written out literally so consent shows it.
function apply($) {
  const p = PALETTES[current]
  $.theme.vars({ id: 'palette-light', mode: 'light', vars: p.light })
  $.theme.vars({ id: 'palette-dark', mode: 'dark', vars: p.dark })
  // Scoped: this sheet only reaches elements this mod drew through $.slot.*.
  $.theme.css({
    id: 'card',
    css: [
      ':scope { border-left: 3px solid var(--accent); border-radius: 6px; }',
      '.mod-slot-sidebar-name { color: var(--accent); font-weight: 600; }'
    ].join('\n')
  })
  const el = $.ui.resolve({})
  $.slot.sidebar({
    id: 'theme',
    title: 'Theme demo',
    tree: [
      el.Text({ text: 'palette: ' + current }),
      el.Button({ id: 'swap', text: 'Swap palette' }),
      el.Button({ id: 'off', text: 'Clear theme' })
    ]
  })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    if (e.plugin !== $.plugin.name) return next(e)
    apply($)
    return next(e)
  })

  on('ui.press', { plugin: 'theming-demo' }, async ($, e, next) => {
    if (e.id === 'swap') {
      current = current === 'forest' ? 'dusk' : 'forest'
      apply($)
    }
    if (e.id === 'off') {
      for (const t of $.theme.list()) $.theme.remove({ id: t.id })
      $.ui.toast('Theme cleared. Swap palette to bring it back.')
    }
    return next(e)
  })
}
