import hljs from 'highlight.js/lib/core'
import type { LanguageFn } from 'highlight.js'
import { HIGHLIGHT_LANGUAGES } from './highlightLanguages'

// API-only highlight.js build: grammars are registered lazily on first use so
// the renderer payload stays small until a file is actually opened.
let registered = false
function ensureRegistered(): void {
  if (registered) return
  for (const [name, grammar] of Object.entries(HIGHLIGHT_LANGUAGES)) {
    try {
      hljs.registerLanguage(name, grammar as LanguageFn)
    } catch {
      // Duplicate registration or unsupported grammar — skip silently.
    }
  }
  registered = true
}

// Extension → registered language. Kept conservative; unknown extensions fall
// back to escaped plaintext rather than a wrong-language guess.
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json',
  py: 'python', pyw: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  css: 'css',
  scss: 'scss', sass: 'scss',
  less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini',
  ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  sql: 'sql',
  r: 'r',
  diff: 'diff', patch: 'diff',
  txt: 'plaintext', log: 'plaintext'
}

export function languageForPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const lang = EXT_TO_LANG[ext]
  if (!lang) return null
  ensureRegistered()
  return hljs.getLanguage(lang) ? lang : null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Returns highlighted HTML for the overlay layer. Unknown/unsupported
// languages degrade to HTML-escaped plaintext so the editor still works.
export function highlightCode(code: string, language: string | null): string {
  ensureRegistered()
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language }).value
    } catch {
      /* fall through to escaped plaintext */
    }
  }
  return escapeHtml(code)
}
