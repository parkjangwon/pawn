import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import './MarkdownRenderer.css'

interface Props {
  content: string
}

export default function MarkdownRenderer({ content }: Props): React.JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
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
