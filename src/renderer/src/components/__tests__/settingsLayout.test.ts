import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = join(__dirname, '..')
const css = (p: string): string => readFileSync(join(dir, p), 'utf8')
const globalCss = readFileSync(join(dir, '../styles/global.css'), 'utf8')

/** Body of the first rule whose selector list matches `selector` exactly. */
function rule(src: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const m = new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(src)
  if (!m) throw new Error(`rule not found: ${selector}`)
  return m[2]
}

describe('shared content column width', () => {
  it('chat and settings both derive from --content-column-max', () => {
    expect(globalCss).toMatch(/--content-column-max:\s*\d+px/)
    expect(globalCss).toMatch(/--chat-content-max:\s*var\(--content-column-max\)/)
    expect(globalCss).toMatch(/--settings-content-max:\s*var\(--content-column-max\)/)
    expect(rule(css('Settings.css'), '.settings-section')).toMatch(/max-width:\s*var\(--settings-content-max\)/)
    expect(rule(css('ChatArea.css'), '.chat-input-container')).toMatch(/max-width:\s*var\(--chat-content-max/)
  })
})

describe('select chevron space', () => {
  it('reserves the arrow width on every select and beats area padding rules', () => {
    expect(globalCss).toMatch(/--select-arrow-space:\s*calc\(/)
    const body = rule(css('Select.css'), '.pawn-select.pawn-select select')
    expect(body).toMatch(/padding-right:\s*var\(--select-arrow-space\)/)
    expect(body).toMatch(/padding-top:\s*0/)
    // The Models vision select no longer caps its width below its longest option.
    expect(rule(css('Settings.css'), '.vision-select')).not.toMatch(/max-width/)
  })

  it('remote execution controls take height from the shared controls and keep the placeholder in the UI font', () => {
    const remote = css('RemoteSettingsPanel.css')
    expect(rule(remote, '.remote-field input,\n.remote-field select')).toMatch(/padding-block:\s*0/)
    expect(rule(remote, '.remote-path-input::placeholder')).toMatch(/font-family:\s*var\(--font-sans\)/)
  })
})

describe('settings buttons use two shared size rules', () => {
  const settingsCss = css('Settings.css')
  it('primary and secondary share one size rule', () => {
    const body = rule(settingsCss, '.settings-page .settings-btn-primary,\n.settings-page .settings-btn-secondary')
    for (const p of ['height: var(--settings-btn-height)', 'min-width: var(--settings-btn-min-width)', 'padding: 0 var(--settings-btn-pad-x)', 'font-size: var(--settings-btn-font-size)']) {
      expect(body).toContain(p)
    }
  })

  const panels = readdirSync(dir).filter((f) => /SettingsPanel\.tsx$/.test(f) || ['KiroAuthPanel.tsx', 'WikiPanel.tsx', 'SkillStorePanel.tsx', 'SubscriptionAuthPanel.tsx', 'XaiAuthPanel.tsx'].includes(f))
  // Not text action buttons: segmented toggles, tabs, tiles, chips, icon/row buttons, text links.
  const EXEMPT = /\b(theme-segment-btn|plugin-scope-btn|plugins-tab|provider-tile|agents-template-chip|wiki-lint-link|wiki-link-chip|wiki-sort|wiki-row-open|wiki-item-delete|decision-preset|telegram-step|hooks-group-head|hooks-cmd|hooks-icon-btn|delete-btn|add-btn-full)\b|routingMode|permissionMode|harnessMode|subagentCostMode|maxParallelSubagents|mcpScope|sleepPrevention|range ===/

  it.each(panels)('%s: every text button carries settings-btn-primary or settings-btn-secondary', (file) => {
    const src = readFileSync(join(dir, file), 'utf8')
    const offenders: string[] = []
    for (const m of src.matchAll(/<(button|Button)\b([\s\S]*?)>/g)) {
      const attrs = m[2]
      if (/size="icon/.test(attrs) || EXEMPT.test(attrs)) continue
      if (!/settings-btn-(primary|secondary)\b/.test(attrs)) offenders.push(attrs.replace(/\s+/g, ' ').slice(0, 80))
    }
    expect(offenders).toEqual([])
  })

  it('Connections: Connect is primary, Disconnect/Cancel secondary, Refresh secondary', () => {
    const src = readFileSync(join(dir, 'ConnectionsSettingsPanel.tsx'), 'utf8')
    expect(src).toMatch(/settings-btn-primary conn-action-btn conn-btn-connect/)
    expect(src).toMatch(/settings-btn-secondary conn-action-btn conn-btn-disconnect/)
    expect(src).toMatch(/settings-btn-secondary conn-action-btn conn-btn-cancel/)
    // conn-action-btn no longer sets its own box size.
    expect(rule(settingsCss, '.conn-action-btn')).not.toMatch(/height|min-width|padding|font-size/)
  })
})

describe('ui polish 2: segmented controls and tabs', () => {
  const read = (f: string): string => readFileSync(join(dir, f), 'utf8')
  it('Wiki scope/view tabs, Plugins tabs and Skill store sort use the shared segmented control', () => {
    expect(read('WikiPanel.tsx')).toMatch(/theme-segmented-control wiki-tabs/)
    expect(read('WikiPanel.tsx')).toMatch(/theme-segmented-control wiki-scope-switch/)
    expect(read('WikiPanel.tsx')).toMatch(/settings-btn-secondary wiki-refresh/)
    expect(read('PluginsSettingsPanel.tsx')).toMatch(/theme-segmented-control plugins-tabs/)
    expect(read('SkillStorePanel.tsx')).toMatch(/theme-segmented-control skill-store-sort/)
    expect(rule(css('Settings.css'), '.wiki-refresh')).toMatch(/margin-left:\s*auto/)
  })
  it('every segment has one height token', () => {
    expect(rule(css('Settings.css'), '.theme-segment-btn,\n.theme-toggle button')).toMatch(/height:\s*var\(--settings-segment-height\)/)
    expect(globalCss).toMatch(/--settings-segment-height:\s*24px/)
  })
  it('settings buttons never shrink, and danger is a modifier of secondary', () => {
    expect(rule(css('Settings.css'), '.settings-page .settings-btn-primary,\n.settings-page .settings-btn-secondary')).toMatch(/flex-shrink:\s*0/)
    expect(css('Settings.css')).toMatch(/\.settings-btn-secondary\.settings-btn-danger\s*\{/)
  })
  it('Telegram inputs: no vertical padding, UI-font placeholder', () => {
    const tg = css('TelegramSettingsPanel.css')
    expect(rule(tg, '.telegram-form input')).toMatch(/padding-block:\s*0/)
    expect(rule(tg, '.telegram-form input::placeholder')).toMatch(/font-family:\s*var\(--font-sans\)/)
  })
})
