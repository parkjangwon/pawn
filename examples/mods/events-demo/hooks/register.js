// events-demo: the roadmap E events and registrations in one small mod.
let calls = 0
let lastTools = []
let notes = 0
let toolRuns = 0
let toolFails = 0
let lastSubagent = 'none'

// $.slot calls are written out literally so the review dialog can list them.
function draw($) {
  const el = $.ui.resolve({})
  $.slot.sidebar({
    id: 'events',
    title: 'Events demo',
    tree: [
      el.Text({ text: 'Model calls: ' + calls }),
      el.Text({ text: 'Last tools: ' + (lastTools.join(', ') || 'none') }),
      el.Text({ text: 'Notifications seen: ' + notes }),
      el.Text({ text: 'Tool runs: ' + toolRuns + ' (failed ' + toolFails + ')' }),
      el.Text({ text: 'Last subagent: ' + lastSubagent })
    ]
  })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    if (e.plugin !== $.plugin.name) return next(e)

    // A subagent from a Claude Code agent file shipped with the mod.
    const md = await $.fs.read($.plugin.root + '/agents/doc-checker.md')
    $.agent.register({ name: 'doc-checker', markdown: md })

    // A provider offer. Nothing changes until you click Add in Settings → Mods.
    $.provider.register({
      id: 'local-ollama',
      name: 'Local Ollama',
      apiFormat: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      models: [{ modelId: 'qwen3:8b', label: 'Qwen3 8B', contextWindow: 32768, supportsTools: true }]
    })

    draw($)
    return next(e)
  })

  // Before each model call: add one short instruction to the system prompt.
  on('model.request', async ($, e, next) => {
    return next({ ...e, systemAppend: 'When you finish a change, name the files you touched.' })
  })

  // After each model call: count it (observe only).
  on('model.response', async ($, e, next) => {
    calls += 1
    lastTools = e.toolCalls.slice(0, 3)
    draw($)
    return next(e)
  })

  // Claude Code's Notification hook name works too.
  on('Notification', async ($, e, next) => {
    notes += 1
    draw($)
    return next(e)
  })

  // Claude Code's PostToolUse / PostToolUseFailure: after a tool really ran.
  on('PostToolUse', async ($, e, next) => {
    toolRuns += 1
    draw($)
    return next(e)
  })
  on('PostToolUseFailure', async ($, e, next) => {
    toolRuns += 1
    toolFails += 1
    draw($)
    return next(e)
  })

  // Claude Code's SubagentStop: when a subagent finishes (ok, error, or aborted).
  on('SubagentStop', async ($, e, next) => {
    lastSubagent = e.agent_type + ' ' + e.status + ' (' + e.rounds + ' rounds)'
    draw($)
    return next(e)
  })
}
