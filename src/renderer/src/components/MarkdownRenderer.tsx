import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import 'highlight.js/styles/github-dark.css'
import './MarkdownRenderer.css'

// Curated subset of highlight.js languages; the full common set is far larger
// than what a coding agent actually renders in chat.
const HIGHLIGHT_LANGUAGES: Record<string, unknown> = {
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

interface Props {
  content: string
}

function MarkdownRenderer({ content }: Props): React.JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          pre: ({ children }) => (
            <div className="code-block-wrapper">
              <div className="code-block-header">
                <span className="code-lang">{extractLang(children)}</span>
                <button className="copy-btn" onClick={() => copyCode(children)}>Copy</button>
              </div>
              <pre>{children}</pre>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// Streaming appends content one chunk at a time; memoizing keeps earlier
// messages from being re-parsed on every token.
export default React.memo(MarkdownRenderer)

function extractLang(children: React.ReactNode): string {
  if (React.isValidElement<{ className?: string }>(children) && children.props?.className) {
    const match = children.props.className.match(/language-(\w+)/)
    return match?.[1] || ''
  }
  return ''
}

function copyCode(children: React.ReactNode): void {
  if (React.isValidElement<{ children?: React.ReactNode }>(children) && children.props?.children) {
    const text = String(children.props.children).replace(/\n$/, '')
    navigator.clipboard.writeText(text)
  }
}
