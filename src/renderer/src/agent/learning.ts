/**
 * Side-effecting half of correction learning: distill the lesson (cheap
 * model when available, heuristic otherwise) and store it as a project
 * Memory card + repo-profile note. Fire-and-forget; never blocks a turn.
 */

import { useUsageStore } from '../stores/usage'
import { parseSummaryResponse, pickSummaryModel } from './compaction'
import { heuristicLesson, LESSON_PROMPT, lessonTitle } from './correctionLearning'
import { fetchWithRetry } from './llm'
import { addProfileNote } from './repoProfile'
import { authHeadersForChat, providerChatUrl } from './testProvider'
import { applyXaiSession } from './xaiSession'

async function distill(input: string, sessionId: string): Promise<string | null> {
  const target = pickSummaryModel(Math.ceil(input.length / 3))
  if (!target) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const body =
      target.provider.apiFormat === 'claude'
        ? { model: target.model.modelId, max_tokens: 120, system: LESSON_PROMPT, messages: [{ role: 'user', content: input }] }
        : {
            model: target.model.modelId,
            max_tokens: 120,
            stream: false,
            messages: [
              { role: 'system', content: LESSON_PROMPT },
              { role: 'user', content: input }
            ]
          }
    const authed = await applyXaiSession(target.provider)
    const res = await fetchWithRetry(providerChatUrl(authed), authHeadersForChat(authed), body, window.api?.platform === 'browser', controller.signal)
    const { text, usage } = parseSummaryResponse(await res.json())
    try {
      useUsageStore.getState().record(sessionId, target.model, usage)
    } catch {
      /* best effort */
    }
    const rule = text.replace(/^["'\s-]+|["'\s]+$/g, '').split('\n')[0].trim()
    if (!rule || /^NONE\b/i.test(rule) || rule.length < 8) return null
    return rule.slice(0, 300)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function learnFromCorrection(opts: {
  sessionId: string
  projectId: string | null
  projectPath?: string
  correction: string
  previousRequest?: string
  previousAnswer?: string
  reverted?: { files: string[] } | null
  useModel: boolean
}): Promise<{ rule: string; saved: boolean } | null> {
  const mem = window.api?.memory
  const input =
    `Previous request: ${opts.previousRequest?.slice(0, 800) || '(unknown)'}\n` +
    `Agent's answer (excerpt): ${opts.previousAnswer?.slice(0, 800) || '(none)'}\n` +
    (opts.reverted ? `The user reverted the agent's file changes${opts.reverted.files.length ? ` (${opts.reverted.files.slice(0, 6).join(', ')})` : ''}.\n` : '') +
    `User's correction: ${opts.correction.slice(0, 1200)}`
  const rule = opts.useModel ? await distill(input, opts.sessionId) : null
  if (opts.useModel && rule === null && !opts.reverted) {
    // The model judged it task-specific (NONE) or was unreachable; only keep
    // strong heuristic signals.
    if (!/\b(always|never|don'?t|instead)\b|항상|절대|말고|하지 ?마|いつも|絶対|不要|别/i.test(opts.correction)) return null
  }
  const content = rule
    ? `${rule}\n(Learned from a user correction: "${opts.correction.trim().slice(0, 240)}")`
    : heuristicLesson({ correction: opts.correction, previousRequest: opts.previousRequest, files: opts.reverted?.files, reverted: !!opts.reverted })
  let saved = false
  if (mem?.save) {
    try {
      const r = (await mem.save({
        content,
        title: rule ? `Lesson: ${rule.slice(0, 70)}` : lessonTitle(opts.correction),
        kind: 'procedure',
        scope: opts.projectId ? 'project' : 'user',
        projectId: opts.projectId,
        tags: ['correction', 'lesson'],
        source: 'auto',
        confidence: rule ? 0.8 : 0.65
      })) as { ok?: boolean; error?: string } | undefined
      saved = !r || r.ok !== false
    } catch {
      saved = false
    }
  }
  if (rule && opts.projectPath) addProfileNote(opts.projectPath, `${rule} (user correction)`)
  return { rule: rule || opts.correction.slice(0, 200), saved }
}
