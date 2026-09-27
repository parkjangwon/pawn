/**
 * Record & Replay, renderer side (pure helpers): the prompt that turns a
 * recording into a SKILL.md, parsing the draft out of the model's answer,
 * and building a "run this skill" prompt from its inputs.
 */

export const SKILL_FENCE = '````skill'
const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

const LANG_NAMES: Record<string, string> = { en: 'English', ko: 'Korean', ja: 'Japanese', zh: 'Simplified Chinese' }

export function languageName(lang: string | undefined): string {
  const base = String(lang || 'en').toLowerCase().split('-')[0]
  return LANG_NAMES[base] || 'English'
}

export function buildDraftSystemPrompt(lang: string | undefined): string {
  const language = languageName(lang)
  return [
    'You turn a recorded demonstration into a reusable Agent Skill (SKILL.md). An AI agent will read it later to do the same task again on its own, usually with different inputs.',
    '',
    'The agent that replays it works in Pawn on macOS and has: the Pawn browser (browser_navigate, browser_snapshot, browser_click, browser_fill, browser_select — elements are found by their visible label), Mac computer use (computer_apps / computer_open to launch apps, computer_ui_snapshot + computer_ui_action on accessibility elements by label, computer_menu, computer_key for shortcuts, computer_type), shell and file tools, and any connected services. It looks at the screen fresh every time: coordinates and pixel positions from the recording mean nothing to it.',
    '',
    'Write the skill so it survives small UI changes:',
    '- Describe each step by intent plus the visible label of what to use ("click the **Submit expense** button"), never by coordinates or CSS selectors.',
    '- Separate what stays the same (fixed choices the user made: category, account, naming pattern) from what changes per run. Values that are clearly run-specific (dates, amounts, file names, recipients, titles, search terms, the goal text) become named inputs; keep constant choices literal.',
    '- Steps marked "not recorded" were secrets. Never invent or ask for passwords in the skill: tell the agent to rely on the existing login (the Pawn browser keeps cookies) or to ask the user to sign in.',
    '- Add checks after important steps (a page title, a confirmation message) and a final verification of the result.',
    '- Before anything irreversible (submit, pay, send, publish, delete) the agent must show the user what it is about to do and get a yes, unless the user asked it to run unattended.',
    '- Drop noise: mis-clicks, scrolling around, dead ends the user backed out of.',
    '- 4–25 numbered steps. Group tiny UI actions into one step when that reads better.',
    '',
    'Answer with exactly this shape. At most one short sentence before the block; the block uses FOUR backticks:',
    '',
    SKILL_FENCE,
    '---',
    'name: <kebab-case English, a-z 0-9 and -, ≤ 64 chars>',
    'description: <1–2 sentences: what it does and when to use it — the agent picks skills by this line>',
    '---',
    '',
    '# <Title>',
    '',
    '## Inputs',
    '- `input_name` — what it is (required | optional, default …). Example from the recording: …',
    '',
    '## Before you start',
    '- Tools: Pawn browser and/or computer use (Mac apps) — name the ones the steps need',
    '- apps / sites needed, login assumptions',
    '',
    '## Steps',
    '1. …',
    '',
    '## Verify',
    '- …',
    '',
    '## Notes',
    '- decision points, gotchas, what to confirm with the user',
    '````',
    '',
    'After the block, one or two lines on what you were unsure about or what the user may want to adjust.',
    `Write the skill body and your comments in ${language}. Keep \`name\` and input names in English (snake_case for inputs, kebab-case for the name). If there are no inputs, write "- none" under Inputs.`
  ].join('\n')
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export function sourceLabels(sources: RecordingSourceDto[]): string {
  return sources.map((s) => (s === 'browser' ? 'Pawn browser' : 'Mac apps')).join(' + ')
}

/** The drafting request: goal, hints and the step list (screenshots go as images). */
export function buildDraftUserText(bundle: RecordingBundleDto): string {
  const lines = [
    `Goal (from the user): ${bundle.goal || '(not given — infer it from the steps)'}`,
    `Changes between runs (from the user): ${bundle.inputsHint || '(not given — infer which values are inputs)'}`,
    `Recorded: ${sourceLabels(bundle.sources)} · ${duration(bundle.durationMs)} · ${bundle.steps.length} steps`
  ]
  if (bundle.notes.length) lines.push(`Recorder notes: ${bundle.notes.join(' ')}`)
  lines.push('', 'Recorded steps (text the user typed is in quotes):', bundle.stepsText || '(no steps were captured)')
  if (bundle.frames.length) {
    lines.push(
      '',
      `Screenshots (${bundle.frames.length}, in order): ${bundle.frames
        .map((f, i) => `#${i + 1} ${f.source === 'browser' ? 'Pawn browser' : 'screen'} after step ${f.step || 'start'}`)
        .join('; ')}.`
    )
  }
  return lines.join('\n')
}

export interface SkillDraft {
  name: string
  description: string
  /** Full SKILL.md text. */
  content: string
  inputs: SkillInput[]
}

export interface SkillInput {
  name: string
  description: string
  required: boolean
  example?: string
}

function unquote(v: string): string {
  return v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
}

/** name / description from front matter (flat keys, folded scalars). */
export function readFrontMatter(content: string): { name?: string; description?: string } | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!m) return null
  const out: { name?: string; description?: string } = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    if (/^[>|]-?$/.test(v)) {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim())
      v = parts.join(v.startsWith('>') ? ' ' : '\n')
    }
    out[kv[1] as 'name' | 'description'] = unquote(v)
  }
  return out
}

export function slugify(raw: string): string {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

/** Replace (or add) the `name:` line in front matter. */
export function withSkillName(content: string, name: string): string {
  const m = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---)/.exec(content)
  if (!m) return `---\nname: ${name}\ndescription: Recorded workflow.\n---\n\n${content}`
  const body = /^name:.*$/m.test(m[2]) ? m[2].replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${m[2]}`
  return content.slice(0, m.index) + m[1] + body + m[3] + content.slice(m.index + m[0].length)
}

/**
 * Locate the SKILL.md in a model answer: a ````skill fence (preferred),
 * a ```skill fence, or a bare document starting with front matter.
 */
export function locateSkillBlock(text: string): { start: number; end: number; body: string } | null {
  const fences = [/(^|\n)````skill[^\n]*\n([\s\S]*?)\n````[ \t]*(?=\n|$)/, /(^|\n)```skill[^\n]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/]
  for (const re of fences) {
    const m = re.exec(text)
    if (m) {
      const start = m.index + m[1].length
      return { start, end: m.index + m[0].length, body: m[2] }
    }
  }
  // Unterminated fence (answer cut off): take everything after it.
  const open = /(^|\n)````skill[^\n]*\n/.exec(text)
  if (open) return { start: open.index + open[1].length, end: text.length, body: text.slice(open.index + open[0].length) }
  const bare = /(^|\n)(---\r?\nname:[\s\S]*)$/.exec(text)
  if (bare) return { start: bare.index + bare[1].length, end: text.length, body: bare[2] }
  return null
}

export function extractSkillDraft(text: string): SkillDraft | null {
  const block = locateSkillBlock(text)
  if (!block) return null
  let content = block.body.replace(/\r\n/g, '\n').trim()
  const fm = readFrontMatter(content)
  if (!fm) return null
  let name = SKILL_NAME_RE.test(fm.name || '') ? fm.name! : slugify(fm.name || '')
  if (!name) {
    const title = /^#\s+(.+)$/m.exec(content)?.[1] || 'recorded-workflow'
    name = slugify(title) || 'recorded-workflow'
  }
  if (name !== fm.name) content = withSkillName(content, name)
  return { name, description: fm.description || '', content: `${content}\n`, inputs: parseSkillInputs(content) }
}

/** Split an answer into text before / the skill / text after (for rendering). */
export function splitSkillAnswer(text: string): { before: string; draft: SkillDraft; after: string } | null {
  const block = locateSkillBlock(text)
  if (!block) return null
  const draft = extractSkillDraft(text)
  if (!draft) return null
  return { before: text.slice(0, block.start).trim(), draft, after: text.slice(block.end).trim() }
}

/** `## Inputs` bullets: - `name` — description (required/optional …). Example: … */
export function parseSkillInputs(content: string): SkillInput[] {
  const sec = /^##\s+Inputs?\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(content)
  if (!sec) return []
  const out: SkillInput[] = []
  for (const line of sec[1].split('\n')) {
    const m = /^\s*[-*]\s+`?([A-Za-z_][\w-]{0,40})`?\s*(?:[—–:-]+\s*)?(.*)$/.exec(line)
    if (!m) continue
    const name = m[1]
    if (/^none$/i.test(name)) continue
    const rest = m[2].trim()
    const required = !/\boptional\b|선택|任意|可选/i.test(rest)
    const ex = /(?:example[^:]*|예시[^:]*|例[^:：]*|示例[^:：]*)[:：]\s*[`"“]?([^`"”\n]+?)[`"”]?\s*\.?$/i.exec(rest)
    out.push({ name, description: rest, required, ...(ex ? { example: ex[1].trim() } : {}) })
  }
  return out.slice(0, 20)
}

/** The prompt that runs a skill with the given inputs (`/skill-name` inlines it). */
export function buildRunPrompt(skillName: string, inputs: SkillInput[], values: Record<string, string>, lang?: string): string {
  const filled = inputs
    .map((i) => ({ name: i.name, value: (values[i.name] ?? '').trim() }))
    .filter((i) => i.value)
  const base = String(lang || 'en').toLowerCase().split('-')[0]
  const intro: Record<string, string> = {
    en: 'Run this skill.',
    ko: '이 스킬대로 실행해줘.',
    ja: 'このスキルを実行して。',
    zh: '按这个技能执行。'
  }
  const lines = [`/${skillName} ${intro[base] || intro.en}`]
  if (filled.length) {
    lines.push('')
    for (const f of filled) lines.push(`- ${f.name}: ${f.value}`)
  }
  return lines.join('\n')
}

/**
 * Automation prompt for a skill. Scheduled runs don't expand `/skill`, so the
 * agent loads it itself; inputs left blank stay as placeholders to edit.
 */
export function buildAutomationPrompt(skillName: string, inputs: SkillInput[], values: Record<string, string> = {}): string {
  const lines = [
    `Load the skill "${skillName}" with load_skill and follow it step by step. ` +
      'If it uses the Pawn browser or Mac apps, call load_tools with browser and/or computer first.'
  ]
  if (inputs.length) {
    lines.push('', 'Inputs for this run:')
    for (const i of inputs) {
      const v = (values[i.name] ?? '').trim()
      lines.push(`- ${i.name}: ${v || `<${i.example ? `e.g. ${i.example}` : i.description.split(/[.(]/)[0].trim() || 'fill in'}>`}`)
    }
  }
  lines.push(
    '',
    'This is a scheduled run and nobody is watching: do not wait for confirmations the skill would normally ask for, but stop and report instead of guessing if something unexpected happens (a login screen, an error, a changed layout). Finish with a short report of what you did and how you verified it.'
  )
  return lines.join('\n')
}

/** Same content modulo line endings / trailing whitespace. */
export function sameSkill(a: string, b: string): boolean {
  const n = (s: string): string => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
  return n(a) === n(b)
}
