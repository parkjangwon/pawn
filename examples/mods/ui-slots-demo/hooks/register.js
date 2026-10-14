// Clicks counted across every slot
let clicks = 0
let greeting = 'hello'

// Each $.slot call is written out literally: consent shows what the source names,
// and a slot call that isn't in the source is refused at runtime.
function draw($) {
  const el = $.ui.resolve({})
  $.slot.sidebar({
    id: 'demo',
    title: 'Slots demo',
    tree: [
      el.Text({ text: 'clicks: ' + clicks + ' · ' + greeting }),
      el.Button({ id: 'bump', text: '+1' })
    ]
  })
  $.slot.header({ id: 'hello', label: 'Hello', title: 'Say hello' })
  $.slot.toolbar({ id: 'reset', label: 'Reset', title: 'Reset the click count' })
  $.slot.settings({
    id: 'prefs',
    title: 'Slots demo',
    tree: [
      el.Text({ text: 'Greeting shown in the sidebar section' }),
      el.Input({ id: 'greeting', placeholder: 'Greeting…', value: greeting })
    ]
  })
  $.slot.statusbar({ id: 'count', text: 'slots: ' + clicks, title: 'Click to add one' })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    if (e.plugin !== $.plugin.name) return next(e)
    draw($)
    return next(e)
  })

  // Every slot click arrives as ui.press with { plugin, id, slot }.
  on('ui.press', { plugin: 'ui-slots-demo' }, async ($, e, next) => {
    if (e.id === 'hello') $.ui.toast('Hello from the ' + e.slot + ' slot')
    if (e.id === 'bump' || e.id === 'count') clicks += 1
    if (e.id === 'reset') clicks = 0
    draw($)
    return next(e)
  })

  on('ui.input', { plugin: 'ui-slots-demo', id: 'greeting' }, async ($, e, next) => {
    greeting = String(e.value || '') || 'hello'
    draw($)
    return next(e)
  })
}
