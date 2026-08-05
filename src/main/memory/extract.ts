/**
 * Heuristic durable-memory extraction from a short conversation window.
 * No network. Complements explicit memory_save tool use.
 *
 * Prefers user utterances. Caps cards per turn to avoid noise.
 */
import type { MemoryKind, MemorySaveInput } from './types'

const PREF_RE =
  /(?:please\s+)?(?:always|never|prefer|don't|do not|i (?:like|prefer|want|hate|use)|use (?:only |always )|remember (?:that |to )?|앞으로|항상|절대|제발|선호|기억해|기억해줘|하지\s*마|いつも|絶対に|〜してほしい|请?永远|不要|记住)[^.!?\n。！？]{6,180}/gi

const FACT_RE =
  /(?:our |the |my |we |이 프로젝트|우리|배포|서버|브랜치|repo|repository|database|db |api |本番|ステージング|主分支|我们的)[^.!?\n。！？]{10,200}/gi

const DECISION_RE =
  /(?:we (?:decided|agreed|chose)|decided to|go with|사용하기로|결정|합의|採用|決定した|我们决定|就用)[^.!?\n。！？]{6,180}/gi

/** Explicit remember / 기억 / 记住 / 覚えて */
const EXPLICIT_RE =
  /(?:remember(?:\s+that)?|memorize|note that|기억해(?:줘|라| 둬)?|기억해\s*[:：]|memo(?:rize)?|覚えて(?:おいて|て)?|记住(?:一下)?|记下)[:\s：]+(.{8,300})/i

function pushCard(
  out: MemorySaveInput[],
  content: string,
  kind: MemoryKind,
  confidence: number,
  tags: string[]
): void {
  const c = content.replace(/\s+/g, ' ').trim()
  if (c.length < 12 || c.length > 500) return
  // Drop pure questions / one-off task chatter
  if (/^(what|how|why|when|where|who|can you|could you|please fix|뭐|어떻|왜|언제)\b/i.test(c)) return
  if (out.some((x) => x.content === c || x.content.includes(c) || c.includes(x.content))) return
  out.push({
    content: c,
    kind,
    confidence,
    tags,
    source: 'auto',
    title: c.slice(0, 72) + (c.length > 72 ? '…' : '')
  })
}

/** Extract candidate memory cards from recent messages (user-heavy). */
export function extractFromMessages(
  messages: Array<{ role: string; content: string }>
): MemorySaveInput[] {
  const out: MemorySaveInput[] = []
  const window = messages.slice(-12)
  for (const m of window) {
    const role = (m.role || '').toLowerCase()
    const text = String(m.content || '')
    if (!text.trim()) continue

    if (role === 'user') {
      const rem = text.match(EXPLICIT_RE)
      if (rem?.[1]) pushCard(out, rem[1], 'fact', 0.92, ['auto', 'explicit'])

      for (const match of Array.from(text.matchAll(PREF_RE))) {
        pushCard(out, match[0], 'preference', 0.72, ['auto', 'preference'])
      }
      for (const match of Array.from(text.matchAll(DECISION_RE))) {
        pushCard(out, match[0], 'decision', 0.7, ['auto', 'decision'])
      }
    }

    if (role === 'user' || role === 'assistant') {
      for (const match of Array.from(text.matchAll(FACT_RE))) {
        const conf = role === 'user' ? 0.55 : 0.48
        pushCard(out, match[0], role === 'assistant' ? 'procedure' : 'fact', conf, [
          'auto',
          role === 'assistant' ? 'procedure' : 'fact'
        ])
      }
    }
  }
  // Prefer higher-confidence first when capping
  out.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  return out.slice(0, 6)
}
