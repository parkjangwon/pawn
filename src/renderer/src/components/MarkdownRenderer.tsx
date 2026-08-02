import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import './MarkdownRenderer.css'
import { HIGHLIGHT_LANGUAGES } from '../utils/highlightLanguages'

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
          a: ({ href, children }) => {
            const safe = safeHref(href)
            if (!safe) {
              // Never render javascript:/data: links; the renderer holds
              // privileged window.api access.
              return <span>{children}</span>
            }
            return <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
          },
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

/** Allow only http(s)/mailto and relative links; block scriptable schemes. */
function safeHref(href: string | undefined): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null
  try {
    const protocol = new URL(trimmed, 'https://base.invalid').protocol
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return trimmed
    return null
  } catch {
    return null
  }
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
