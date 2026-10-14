// Clicks counted across every slot
let clicks = 0
let greeting = 'hello'
// Pinned messages, per chat: sessionId -> Set of message ids
const pins = new Map()
let shortcutError = ''

function pinsFor(sessionId) {
  if (!pins.has(sessionId)) pins.set(sessionId, new Set())
  return pins.get(sessionId)
}

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
  $.slot.palette({ id: 'bump', title: 'Slots demo: add one', hint: 'clicks: ' + clicks })
  // A clash with an app or mod shortcut throws; it never overrides silently.
  try {
    $.slot.shortcut({ id: 'bump', keys: 'Mod+Shift+U', title: 'Slots demo: add one' })
    shortcutError = ''
  } catch (err) {
    shortcutError = String((err && err.message) || err)
  }
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
    if (e.slot === 'message' && e.id === 'pin') {
      const set = pinsFor(e.sessionId)
      if (set.has(e.messageId)) set.delete(e.messageId)
      else set.add(e.messageId)
    }
    draw($)
    return next(e)
  })

  on('ui.input', { plugin: 'ui-slots-demo', id: 'greeting' }, async ($, e, next) => {
    greeting = String(e.value || '') || 'hello'
    draw($)
    return next(e)
  })

  // Badges, actions and blocks under finished messages. Never sees a streaming reply.
  on('message.render', async ($, e, next) => {
    if (e.role !== 'assistant') return next(e)
    const words = String(e.text || '').trim().split(/\s+/).filter(Boolean).length
    const pinned = pinsFor(e.sessionId).has(e.messageId)
    const props = {
      badges: [...e.props.badges, { id: 'words', text: words + ' words', tone: 'info' }],
      actions: [...e.props.actions, { id: 'pin', label: pinned ? 'Unpin' : 'Pin' }],
      blocks: pinned
        ? [...e.props.blocks, { id: 'pinned', tree: $.ui.resolve({}).Text({ text: 'Pinned in this chat' }) }]
        : e.props.blocks
    }
    return next({ ...e, props })
  })
}
