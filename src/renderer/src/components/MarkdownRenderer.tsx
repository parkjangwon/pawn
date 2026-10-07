import React, { memo, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, X } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import './MarkdownRenderer.css'
import { HIGHLIGHT_LANGUAGES } from '../utils/highlightLanguages'
import { isInlineImageSrc } from '../utils/safeUrl'
import { REVEAL_EVENT } from '../utils/conversationFind'
import { IMAGE_EXT, LocalFileLink, LocalImage, MarkdownBaseDirContext, PathCode, resolveLocalPath } from './LocalFileLinks'

/** Code blocks longer than this fold to a preview with "Show all N lines". */
export const CODE_FOLD_THRESHOLD_LINES = 30

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
  // Absolute local paths (/Users/…, C:\…) are resolved by the link / image
  // components; defaultUrlTransform would keep them anyway, but be explicit.
  if (url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)) return url
  return defaultUrlTransform(url)
}

function MarkdownRendererInner({ content }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const baseDir = useContext(MarkdownBaseDirContext)
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
      // Local files (file://, absolute, or relative to the chat's folder)
      // open inside Pawn; ⌘/Ctrl-click reveals them in Finder/Explorer.
      const local = resolveLocalPath(href, baseDir)
      if (local) return <LocalFileLink path={local}>{children}</LocalFileLink>
      const safe = safeHref(href)
      if (!safe || safe.startsWith('file://') || !/^(https?:|mailto:)/i.test(safe)) {
        // Never render javascript:/data: links; the renderer holds
        // privileged window.api access.
        return <span>{children}</span>
      }
      return <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (!src) return null
      const label = alt || t('chat.attachedImage')
      if (!isInlineImageSrc(src)) {
        // Local images load through the main process (never file:/remote fetches).
        const local = resolveLocalPath(src, baseDir)
        if (local && IMAGE_EXT.test(local)) return <LocalImage path={local} alt={label} onOpen={openLightbox} />
        if (local) return <LocalFileLink path={local}>{label}</LocalFileLink>
        // Remote images never auto-load; show a plain link the user can choose to open.
        const safe = safeHref(src)
        if (!safe || !/^https?:/i.test(safe)) return <span>{label}</span>
        return <a href={safe} target="_blank" rel="noopener noreferrer">{label}</a>
      }
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
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
      className ? <code className={className}>{children}</code> : <PathCode text={getNodeText(children)}>{children}</PathCode>,
    pre: ({ children }: { children?: React.ReactNode }) => <CodeBlock>{children}</CodeBlock>
  }), [t, openLightbox, baseDir])

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
        <X size={18} />
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

// Streaming appends content one chunk at a time; memoizing keeps earlier
// messages from being re-parsed on every token.
const MarkdownRenderer = memo(MarkdownRendererInner)
export default MarkdownRenderer

function getNodeText(node: React.ReactNode): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.props?.children) {
    return getNodeText(node.props.children)
  }
  return ''
}

function CodeBlock({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const lang = extractLang(children)
  const text = useMemo(() => getNodeText(children).replace(/\n$/, ''), [children])
  const lineCount = text ? text.split('\n').length : 0
  const foldable = lineCount > CODE_FOLD_THRESHOLD_LINES
  const folded = foldable && !expanded

  // Conversation find unfolds the block when its active match is inside.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || !foldable) return
    const reveal = (): void => setExpanded(true)
    el.addEventListener(REVEAL_EVENT, reveal)
    return () => el.removeEventListener(REVEAL_EVENT, reveal)
  }, [foldable])

  const handleCopy = useCallback((): void => {
    if (!text) return
    void navigator.clipboard?.writeText(text)?.catch?.(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <div
      ref={wrapperRef}
      className={`code-block-wrapper${folded ? ' folded' : ''}`}
      data-folded={folded ? 'true' : undefined}
    >
      <div className="code-block-header" data-find-ignore="true">
        <span className="code-lang">{lang}</span>
        {foldable && (
          <span className="code-lines">{t('markdown.codeLines', { count: lineCount })}</span>
        )}
        <button
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? t('markdown.codeCopied') : t('markdown.copyCode')}
        >
          {copied ? (
            <>
              <Check size={12} />
              <span>{t('chat.copied')}</span>
            </>
          ) : (
            t('chat.copy')
          )}
        </button>
      </div>
      <div className="code-block-body">
        <pre>{children}</pre>
      </div>
      {foldable && (
        <button
          type="button"
          className="code-fold-toggle"
          aria-expanded={!folded}
          onClick={() => {
            const collapsing = !folded
            setExpanded((v) => !v)
            // Collapsing a long block can leave the reader far below it.
            if (collapsing) {
              requestAnimationFrame(() => {
                const el = wrapperRef.current
                if (!el || typeof el.scrollIntoView !== 'function') return
                const viewTop = el.closest('.chat-messages')?.getBoundingClientRect().top ?? 0
                if (el.getBoundingClientRect().top < viewTop) el.scrollIntoView({ block: 'nearest' })
              })
            }
          }}
        >
          <ChevronDown size={12} aria-hidden style={{ transform: folded ? 'none' : 'rotate(180deg)' }} />
          {folded ? t('markdown.expandCode', { count: lineCount }) : t('markdown.collapseCode')}
        </button>
      )}
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
