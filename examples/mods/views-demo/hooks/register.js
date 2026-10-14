// A custom view is plain HTML plus one script, run in a sandboxed iframe.
// Inside it, `pawn.call(method, ...args)` reaches only the bridge calls this file
// names literally ($.ui.toast, $.store.get, $.store.set below), and
// `pawn.send(data)` arrives here as a `view.message` event.

const STYLE = `<style>
  button { font: inherit; padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);
           background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; }
  button.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .big { font-size: 28px; font-weight: 600; color: var(--accent); }
  .muted { color: var(--text-muted); font-size: 12px; }
</style>`

const PANEL_HTML = STYLE + `
  <div class="muted">Saved with $.store, inside a sandboxed frame</div>
  <div class="big" id="n">…</div>
  <div class="row">
    <button class="primary" id="inc">+1</button>
    <button id="toast">Toast</button>
  </div>
  <div class="row">
    <button id="tab">Open tab</button>
    <button id="modal">Open dialog</button>
  </div>
  <div class="muted" id="msg"></div>`

const PANEL_SCRIPT = `
  const n = document.getElementById('n')
  const show = (v) => { n.textContent = String(v) }
  pawn.call('store.get', 'count').then((v) => show(v || 0))
  document.getElementById('inc').addEventListener('click', async () => {
    const v = ((await pawn.call('store.get', 'count')) || 0) + 1
    await pawn.call('store.set', 'count', v)
    show(v)
    pawn.send({ type: 'count', value: v })
  })
  document.getElementById('toast').addEventListener('click', () => pawn.call('ui.toast', 'Hello from a mod view'))
  document.getElementById('tab').addEventListener('click', () => pawn.send({ type: 'open', placement: 'tab' }))
  document.getElementById('modal').addEventListener('click', () => pawn.send({ type: 'open', placement: 'modal' }))
  pawn.onMessage((data) => { document.getElementById('msg').textContent = data && data.text ? data.text : '' })
  // Not on the bridge list: refused even though the frame asks.
  pawn.call('process.run', ['id']).catch((e) => console.log('refused:', e.message))
`

const INFO_HTML = STYLE + `
  <h3 style="margin:0 0 6px">Views demo</h3>
  <p class="muted">This page is a mod view. It has no network access, no access to Pawn's window,
  and can only call the $ functions its mod names in source.</p>
  <div class="row"><button class="primary" id="close">Close</button></div>`

const INFO_SCRIPT = `document.getElementById('close').addEventListener('click', () => pawn.send({ type: 'close' }))`

export function register(on) {
  on('session.start', async ($, e, next) => {
    if (e.plugin !== $.plugin.name) return next(e)
    $.view.open({ id: 'counter', title: 'Views demo', placement: 'panel', html: PANEL_HTML, script: PANEL_SCRIPT, height: 190 })
    return next(e)
  })

  on('view.message', { plugin: 'views-demo' }, async ($, e, next) => {
    const d = e.data || {}
    if (d.type === 'count') {
      $.view.post({ id: 'counter', data: { text: 'mod saw count ' + d.value } })
    }
    if (d.type === 'open') {
      const id = d.placement === 'modal' ? 'about-modal' : 'about-tab'
      $.view.open({ id, title: 'About views', placement: d.placement, html: INFO_HTML, script: INFO_SCRIPT, height: 170 })
    }
    if (d.type === 'close') {
      $.view.close({ id: e.id })
    }
    return next(e)
  })
}

// Bridge calls the view uses must appear literally in source:
// $.store.get  $.store.set  $.ui.toast
