/**
 * Guards for the things that made the UI copy feel sloppy: mixed Korean
 * endings, English left in translations, mismatched placeholders, "(s)"
 * plurals, three-dot ellipses and hardcoded English in components.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import en from '../locales/en.json'
import ko from '../locales/ko.json'
import ja from '../locales/ja.json'
import zh from '../locales/zh.json'

type Flat = Record<string, string>
function flat(obj: Record<string, unknown>, prefix = '', out: Flat = {}): Flat {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flat(v as Record<string, unknown>, p, out)
    else out[p] = String(v)
  }
  return out
}
const F = { en: flat(en), ko: flat(ko), ja: flat(ja), zh: flat(zh) }
const placeholders = (s: string): string[] => (s.match(/\{\{\s*\w+\s*\}\}/g) || []).map((x) => x.replace(/\s/g, '')).sort()

describe('translation quality', () => {
  it('uses the same {{placeholders}} as English in every language', () => {
    const bad: string[] = []
    for (const [key, text] of Object.entries(F.en)) {
      for (const lang of ['ko', 'ja', 'zh'] as const) {
        const other = F[lang][key]
        // Singular forms may spell the number out ("1 file") in languages without plurals.
        if (key.endsWith('_one')) continue
        if (other !== undefined && placeholders(other).join() !== placeholders(text).join()) bad.push(`${lang}:${key}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('pairs every _one plural with its other form', () => {
    for (const lang of Object.keys(F) as (keyof typeof F)[]) {
      const orphans = Object.keys(F[lang]).filter((k) => k.endsWith('_one') && !(k.slice(0, -4) in F[lang]) && !(`${k.slice(0, -4)}_other` in F[lang]))
      expect(orphans, lang).toEqual([])
    }
  })

  it('Korean reads as one voice (해요체), with one word per concept', () => {
    const formal = Object.entries(F.ko).filter(([, v]) => /(습니다|합니다|됩니다|입니다|십시오|습니까|십니까)(?=[\s.!?…),]|$)/.test(v))
    expect(formal.map(([k]) => k)).toEqual([])
    // A conversation is a 채팅 (not 세션); "새 작업" was a third name for it.
    const words = Object.entries(F.ko).filter(([k, v]) => (/세션/.test(v) && !/세션 토큰/.test(v)) || v === '새 작업')
    expect(words.map(([k]) => k)).toEqual([])
  })

  it('English: real plurals, sentence case and a real ellipsis', () => {
    const texts = Object.entries(F.en)
    expect(texts.filter(([, v]) => v.includes('(s)')).map(([k]) => k)).toEqual([])
    expect(texts.filter(([, v]) => /(?<!\.)\.\.\.(?!\.)/.test(v)).map(([k]) => k)).toEqual([])
    const titleCase = texts.filter(([, v]) => /^(New|Add|Delete|Edit|Select|Switch|Toggle|Create|Export|Import|Test) [A-Z][a-z]+$/.test(v) && !/ (MCP|Pawn|DevTools|GitHub|Google)$/.test(v))
    expect(titleCase.map(([k, v]) => `${k}=${v}`)).toEqual([])
  })

  it('no English sentences left in Japanese or Chinese', () => {
    const brands = /^(Claude Code|OpenAI Agents|IAM Identity Center|AWS Builder ID|AWS CodeCommit|User Settings|Personal Access Token|Secret Access Key|Access Key ID|Kiro CLI|GitHub Releases|Command Code|OpenCode Go|Xiaomi MiMo|Token Plan API|Google Docs|ULTRA WORK|Git diff|git diff HEAD)/
    for (const lang of ['ja', 'zh'] as const) {
      const left = Object.entries(F[lang]).filter(([key, v]) => {
        const t = v.replace(/\{\{\w+\}\}|https?:\/\/\S+|~\/\S+|`[^`]*`|\b[\w.-]+\.(json|md|toml)\b/g, '')
        const m = /\b[A-Za-z]{3,}\b(?:\s+[A-Za-z]{2,}\b){2,}/.exec(t)
        return m && !brands.test(m[0]) && F.en[key] !== undefined
      })
      expect(left.map(([k, v]) => `${k}=${v}`), lang).toEqual([])
    }
  })
})

describe('components have no hardcoded user-facing English', () => {
  const root = join(__dirname, '../../components')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__') walk(p)
      } else if (p.endsWith('.tsx')) files.push(p)
    }
  }
  walk(root)

  it('aria-label / title / placeholder attributes come from t()', () => {
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const m = /\b(aria-label|title|placeholder)="([A-Za-z][a-z]+ [A-Za-z][^"]*)"/.exec(line)
        if (m) hits.push(`${f.split('components/')[1]}:${i + 1} ${m[1]}="${m[2]}"`)
      })
    }
    expect(hits).toEqual([])
  })

  it('no English defaultValue fallbacks (every key exists in every language)', () => {
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/defaultValue:\s*['"`][A-Za-z가-힣]/.test(line)) hits.push(`${f.split('components/')[1]}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
