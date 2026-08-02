import { common } from 'lowlight'

// Shared curated language set: the chat markdown renderer and the in-panel
// file editor both draw from this so language coverage stays consistent.
export const HIGHLIGHT_LANGUAGES: Record<string, unknown> = {
  bash: common.bash,
  c: common.c,
  cpp: common.cpp,
  css: common.css,
  diff: common.diff,
  go: common.go,
  ini: common.ini,
  java: common.java,
  javascript: common.javascript,
  json: common.json,
  kotlin: common.kotlin,
  less: common.less,
  markdown: common.markdown,
  plaintext: common.plaintext,
  python: common.python,
  r: common.r,
  ruby: common.ruby,
  rust: common.rust,
  scss: common.scss,
  shell: common.shell,
  sql: common.sql,
  swift: common.swift,
  typescript: common.typescript,
  xml: common.xml,
  yaml: common.yaml
}
