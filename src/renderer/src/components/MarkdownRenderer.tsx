import React, { memo, useCallback, useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import './MarkdownRenderer.css'
import { HIGHLIGHT_LANGUAGES } from '../utils/highlightLanguages'

interface Props {
  content: string
}

interface LightboxState {
  src: string
  alt: string
}

/**
 * react-markdown's defaultUrlTransform only allows http(s)/mailto/… and
 * strips data: URLs, which turns user-attached images (`![x](data:image/…)`
 * from buildDisplayContent) into broken <img> placeholders. Allow image data
 * URLs while keeping other schemes blocked.
 */
function safeUrlTransform(url: string): string {
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(url)) return url
  if (/^file:/i.test(url)) return url
  return defaultUrlTransform(url)
}

function MarkdownRendererInner({ content }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  const closeLightbox = useCallback((): void => setLightbox(null), [])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeLightbox()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
    }
  }, [lightbox, closeLightbox])

  const openLightbox = useCallback((src: string, alt: string): void => {
    setLightbox({ src, alt })
  }, [])

  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const safe = safeHref(href)
      if (!safe) {
        // Never render javascript:/data: links; the renderer holds
        // privileged window.api access.
        return <span>{children}</span>
      }
      // Local file links reveal the file in Finder/Explorer instead of
      // navigating the renderer to a file:// URL.
      if (safe.startsWith('file://')) {
        const localPath = decodeFilePath(safe)
        return (
          <a
            className="md-file-link"
            href={safe}
            title={localPath}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void Promise.resolve(window.api?.workspace?.reveal?.(localPath)).catch(() => {})
            }}
          >
            {children}
          </a>
        )
      }
      return <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (!src) return null
      const label = alt || t('chat.attachedImage')
      return (
        <img
          className="md-inline-image"
          src={src}
          alt={label}
          loading="lazy"
          title={t('chat.imageExpandHint')}
          role="button"
          tabIndex={0}
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openLightbox(src, label)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openLightbox(src, label)
            }
          }}
        />
      )
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <div className="code-block-wrapper">
        <div className="code-block-header">
          <span className="code-lang">{extractLang(children)}</span>
          <button className="copy-btn" onClick={() => copyCode(children)}>Copy</button>
        </div>
        <pre>{children}</pre>
      </div>
    )
  }), [t, openLightbox])

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES }]]}
        urlTransform={safeUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
      {lightbox && createPortal(
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />,
        document.body
      )}
    </div>
  )
}

function ImageLightbox({ src, alt, onClose }: {
  src: string
  alt: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="md-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.imageLightbox')}
      onClick={onClose}
    >
      <button
        type="button"
        className="md-image-lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label={t('common.close')}
        title={t('common.close')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <img
        className="md-image-lightbox-img"
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
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
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'file:') return trimmed
    return null
  } catch {
    return null
  }
}

/** file:///Users/a.ts → /Users/a.ts; file:///C:/x.ts → C:/x.ts (Windows). */
function decodeFilePath(href: string): string {
  let p = href.slice('file://'.length)
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  try {
    p = decodeURIComponent(p)
  } catch {
    /* keep raw */
  }
  return p
}

// Streaming appends content one chunk at a time; memoizing keeps earlier
// messages from being re-parsed on every token.
const MarkdownRenderer = memo(MarkdownRendererInner)
export default MarkdownRenderer

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
