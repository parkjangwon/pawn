import React, { memo, useCallback, useContext, useEffect, useId, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'
import {
  Streamdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
} from 'streamdown'
import type { CjkPlugin, StreamdownProps } from 'streamdown'
import { code as codeHighlighter } from '@streamdown/code'
import type { HighlightResult } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { mermaid as mermaidPlugin } from '@streamdown/mermaid'
import { cjk } from '@streamdown/cjk'
import { harden } from 'rehype-harden'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import 'katex/dist/katex.min.css'
import './MarkdownRenderer.css'
import { isInlineImageSrc } from '../utils/safeUrl'
import { REVEAL_EVENT } from '../utils/conversationFind'
import { IMAGE_EXT, LocalFileLink, LocalImage, MarkdownBaseDirContext, PathCode, resolveLocalPath } from './LocalFileLinks'

/** Code blocks longer than this fold to a preview with "Show all N lines". */
export const CODE_FOLD_THRESHOLD_LINES = 30

interface Props {
  content: string
  /** True while the message is still streaming in: repairs incomplete
   *  markdown, skips async highlight/diagram work until the text settles. */
  streaming?: boolean
}

interface LightboxState {
  src: string
  alt: string
}

type RemarkPluginList = NonNullable<StreamdownProps['remarkPlugins']>
type RehypePluginList = NonNullable<StreamdownProps['rehypePlugins']>

/**
 * Rendering approach ported from ZCode's Streamdown-based MessageResponse
 * (Apache-2.0, see DESIGN.md): streamdown parsing with shiki code
 * highlighting, KaTeX math, mermaid diagrams and CJK-friendly GFM.
 * Reimplemented for pawn: no workspace/editor/citation machinery, and
 * pawn's own link/image security model (no remote fetches, no scriptable
 * schemes) is preserved.
 */

// Single `$...$` inline math needs a guard: `$5-$10` prices and `$HOME`
// paths must keep rendering as plain text. Escape lone dollars unless the
// enclosed content looks like math (a TeX command, math symbols, or a bare
// identifier), skipping fenced blocks and inline code spans.
const TEX_COMMAND = /\\[A-Za-z]+/
const MATH_CHARS = /[\\{}^_=+\-*/<>|()[\]]/
const BARE_MATH_WORD = /^(?:[A-Za-z]|[a-z][A-Za-z0-9]{1,2}|\d+(?:\.\d+)?)$/
const CURRENCY_PREFIX = /^(?:\d[\d,]*(?:\.\d+)?|\.\d+)[+\-*/]$/
const FENCE_LINE = /^(?: {0,3})(`{3,}|~{3,})/

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++
  return slashes % 2 === 1
}

function isDollar(text: string, index: number): boolean {
  return text[index] === '$' && text[index - 1] !== '$' && text[index + 1] !== '$' && !isEscaped(text, index)
}

function normalizeInlineMathText(text: string): string {
  if (!text.includes('$')) return text
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (!isDollar(text, i)) {
      out += text[i]
      continue
    }
    let close = -1
    for (let j = i + 1; j < text.length; j++) {
      if (isDollar(text, j)) {
        close = j
        break
      }
    }
    if (close === -1) {
      out += text[i]
      continue
    }
    const inner = text.slice(i + 1, close)
    if (!inner || inner !== inner.trim() || /[\r\n]/.test(inner)) {
      out += '\\$'
      continue
    }
    const next = text.slice(close + 1)
    if ((TEX_COMMAND.test(inner) || MATH_CHARS.test(inner) || BARE_MATH_WORD.test(inner)) &&
        !(CURRENCY_PREFIX.test(inner) && /^(?:\d|\.\d)/.test(next))) {
      out += text.slice(i, close + 1)
      i = close
    } else {
      out += '\\$'
    }
  }
  return out
}

function normalizeInlineMathLine(line: string): string {
  let out = ''
  let cursor = 0
  while (cursor < line.length) {
    const tick = line.indexOf('`', cursor)
    if (tick === -1) {
      out += normalizeInlineMathText(line.slice(cursor))
      break
    }
    out += normalizeInlineMathText(line.slice(cursor, tick))
    let end = tick + 1
    while (line[end] === '`') end++
    const marker = line.slice(tick, end)
    const stop = line.indexOf(marker, end)
    if (stop === -1) {
      out += normalizeInlineMathText(line.slice(tick))
      break
    }
    out += line.slice(tick, stop + marker.length)
    cursor = stop + marker.length
  }
  return out
}

function normalizeSingleDollarMath(markdown: string): string {
  if (!markdown.includes('$')) return markdown
  const lines = markdown.split('\n')
  let fence: { marker: string; length: number } | null = null
  return lines.map((line) => {
    if (fence) {
      const m = FENCE_LINE.exec(line)
      if (m && m[1][0] === fence.marker && m[1].length >= fence.length) fence = null
      return line
    }
    const m = FENCE_LINE.exec(line)
    if (m) {
      fence = { marker: m[1][0], length: m[1].length }
      return line
    }
    return normalizeInlineMathLine(line)
  }).join('\n')
}

// remark-gfm and the CJK strikethrough extension both enable single-tilde
// `~text~` strikethrough; GFM treats it as literal text, so switch it off
// in both to keep pawn's previous rendering.
function withoutSingleTilde(plugin: unknown): unknown {
  if (!Array.isArray(plugin)) {
    return typeof plugin === 'function' ? [plugin, { singleTilde: false }] : plugin
  }
  const [attacher, options] = plugin as [unknown, unknown]
  return [attacher, {
    ...((typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>),
    singleTilde: false,
  }]
}

const mathPlugin = createMathPlugin({ singleDollarTextMath: true })

const cjkPlugin = {
  ...cjk,
  remarkPlugins: [...cjk.remarkPluginsBefore, ...cjk.remarkPluginsAfter.map(withoutSingleTilde)],
  remarkPluginsAfter: cjk.remarkPluginsAfter.map(withoutSingleTilde),
} as unknown as CjkPlugin

const remarkPlugins = [
  ...Object.entries(defaultRemarkPlugins).map(([name, plugin]) =>
    name === 'gfm' ? withoutSingleTilde(plugin) : plugin,
  ),
] as unknown as RemarkPluginList

interface HastNode {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/**
 * Local targets never survive Streamdown's hardening (the `file:` protocol
 * is blocked outright, and relative image sources can't resolve without an
 * origin), so stash them in a same-origin envelope the pipeline passes
 * through untouched, and recover the original in the custom renderers.
 * The envelope host never hits the network: it is unwrapped before render
 * and never assigned to a fetchable attribute.
 */
const LOCAL_REF_PREFIX = 'https://pawn.local/__pawn_local__?src='

function encodeLocalRef(original: string): string {
  return `${LOCAL_REF_PREFIX}${encodeURIComponent(original)}`
}

function decodeLocalRef(value: string): string | null {
  if (!value.startsWith(LOCAL_REF_PREFIX)) return null
  const query = value.slice(LOCAL_REF_PREFIX.length).split('&')[0]
  try {
    return decodeURIComponent(query)
  } catch {
    return null
  }
}

function stashLocalTarget(value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.startsWith('#')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^file:/i.test(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) return null
  return encodeLocalRef(raw)
}

function pawnLocalRefRehypePlugin() {
  const visit = (node: HastNode): void => {
    const attr = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null
    if (node.type === 'element' && attr && typeof node.properties?.[attr] === 'string') {
      const stashed = stashLocalTarget(node.properties[attr] as string)
      if (stashed) node.properties[attr] = stashed
    }
    node.children?.forEach(visit)
  }
  return (tree: HastNode): void => {
    visit(tree)
  }
}

const { sanitize: _builtinSanitize, harden: _builtinHarden, ...rehypeRest } = defaultRehypePlugins as Record<string, unknown>
void _builtinSanitize
void _builtinHarden
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data', 'blob'],
  },
}
const rehypePlugins = [
  ...Object.values(rehypeRest),
  pawnLocalRefRehypePlugin,
  [rehypeSanitize, sanitizeSchema],
  // Pawn's own link/image renderers enforce the security model (no
  // scriptable schemes, no remote fetches), so hardening only needs to
  // defuse what slips past: blocked targets degrade to plain text.
  [harden, {
    allowedImagePrefixes: ['*'],
    allowedLinkPrefixes: ['*'],
    allowedProtocols: ['*'],
    allowDataImages: true,
    linkBlockPolicy: 'text-only',
    imageBlockPolicy: 'text-only',
  }],
] as unknown as RehypePluginList

function resolveHref(href: string | undefined): string {
  if (!href) return ''
  return decodeLocalRef(href) ?? href
}

function MarkdownRendererInner({ content, streaming = false }: Props): React.JSX.Element {
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

  const targetMarkdown = useMemo(
    () => normalizeSingleDollarMath(content),
    [content],
  )

  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const resolved = resolveHref(href)
      // Local files (file://, absolute, or relative to the chat's folder)
      // open inside Pawn; ⌘/Ctrl-click reveals them in Finder/Explorer.
      const local = resolveLocalPath(resolved, baseDir)
      if (local) return <LocalFileLink path={local}>{children}</LocalFileLink>
      const safe = safeHref(resolved)
      if (!safe || !/^(https?:|mailto:)/i.test(safe)) {
        // Never render javascript:/data: links; the renderer holds
        // privileged window.api access.
        return <span>{children}</span>
      }
      return <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (!src) return null
      const resolved = resolveHref(src)
      const label = alt || 'Pasted image'
      if (!isInlineImageSrc(resolved)) {
        // Local images load through the main process (never file:/remote fetches).
        const local = resolveLocalPath(resolved, baseDir)
        if (local && IMAGE_EXT.test(local)) return <LocalImage path={local} alt={label} onOpen={openLightbox} />
        if (local) return <LocalFileLink path={local}>{label}</LocalFileLink>
        // Remote images never auto-load; show a plain link the user can choose to open.
        const safe = safeHref(resolved)
        if (!safe || !/^https?:/i.test(safe)) return <span>{label}</span>
        return <a href={safe} target="_blank" rel="noopener noreferrer">{label}</a>
      }
      return (
        <img
          className="md-inline-image"
          src={resolved}
          alt={label}
          loading="lazy"
          title={'Double-click to enlarge'}
          role="button"
          tabIndex={0}
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openLightbox(resolved, label)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openLightbox(resolved, label)
            }
          }}
        />
      )
    },
    code: ({ className, children, ...rest }: {
      className?: string
      children?: React.ReactNode
      node?: unknown
      'data-block'?: unknown
    }) => {
      if (!('data-block' in rest)) {
        if (className) return <code className={className}>{children}</code>
        return <PathCode text={getNodeText(children)}>{children}</PathCode>
      }
      const text = getNodeText(children).replace(/\n$/, '')
      const lang = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? 'text'
      // Inline-code file paths that exist open inside Pawn.
      if ((lang === 'text' || lang === 'txt' || !className) && !text.includes('\n')) {
        return <PathCode text={text}>{children}</PathCode>
      }
      if (lang.toLowerCase() === 'mermaid' || lang.toLowerCase() === 'mmd') {
        return <MermaidBlock code={text} streaming={streaming} />
      }
      return <CodeBlock code={text} lang={lang} streaming={streaming} />
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="md-table-scroll">
        <table>{children}</table>
      </div>
    ),
  }), [openLightbox, baseDir, streaming])

  return (
    <div className="markdown-body">
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        parseIncompleteMarkdown={streaming}
        components={components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        plugins={{ cjk: cjkPlugin, math: mathPlugin, mermaid: mermaidPlugin }}
        controls={false}
        linkSafety={{ enabled: false }}
        animated={false}
        isAnimating={false}
      >
        {targetMarkdown}
      </Streamdown>
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
  return (
    <div
      className="md-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={'Enlarged image'}
      onClick={onClose}
    >
      <button
        type="button"
        className="md-image-lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label={'Close'}
        title={'Close'}
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

/** Shiki token colors; fontStyle is shiki's bitmask (1 italic, 2 bold, 4 underline). */
function tokenStyle(token: { color?: string; fontStyle?: number }): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (token.color) style.color = token.color
  if (token.fontStyle) {
    if (token.fontStyle & 1) style.fontStyle = 'italic'
    if (token.fontStyle & 2) style.fontWeight = 'bold'
    if (token.fontStyle & 4) style.textDecoration = 'underline'
  }
  return style
}

function ShikiCode({ code, language }: { code: string; language: string }): React.JSX.Element {
  const [result, setResult] = useState<HighlightResult | null>(null)
  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!code) return
    const lang = language.trim().toLowerCase()
    if (lang === 'text' || lang === 'txt' || lang === 'plain') return
    let supported = false
    try {
      supported = codeHighlighter.supportsLanguage(lang as Parameters<typeof codeHighlighter.supportsLanguage>[0])
    } catch {
      supported = false
    }
    if (!supported) return
    const theme = document.querySelector('.app.dark') ? 'github-dark' : 'github-light'
    try {
      const out = codeHighlighter.highlight(
        {
          code,
          language: lang as Parameters<typeof codeHighlighter.highlight>[0]['language'],
          themes: [theme, theme],
        },
        (res) => {
          if (!cancelled) setResult(res)
        },
      )
      if (out && !cancelled) setResult(out)
    } catch {
      /* plain-text fallback */
    }
    return () => {
      cancelled = true
    }
  }, [code, language])
  if (!result) return <>{code}</>
  return (
    <>
      {result.tokens.map((line, i) => (
        <span key={i} className="shiki-line">
          {line.map((token, j) => (
            <span key={j} style={tokenStyle(token)}>{token.content}</span>
          ))}
          {'\n'}
        </span>
      ))}
    </>
  )
}

function MermaidBlock({ code, streaming }: { code: string; streaming: boolean }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  useEffect(() => {
    if (streaming || !code.trim()) return
    let cancelled = false
    setFailed(false)
    setSvg(null)
    try {
      const dark = Boolean(document.querySelector('.app.dark'))
      mermaidPlugin.getMermaid({ theme: dark ? 'dark' : 'default' }).render(`pawn-mmd-${id}`, code)
        .then(({ svg: rendered }) => {
          if (!cancelled) setSvg(rendered)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    } catch {
      if (!cancelled) setFailed(true)
    }
    return () => {
      cancelled = true
    }
  }, [code, streaming, id])
  if (svg && !failed) {
    return (
      <div className="code-block-wrapper md-mermaid">
        <div className="code-block-header" data-find-ignore="true">
          <span className="code-lang">diagram</span>
        </div>
        <div className="md-mermaid-body" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    )
  }
  return <CodeBlock code={code} lang="mermaid" streaming={streaming} highlight={failed || streaming} />
}

function CodeBlock({ code, lang, streaming, highlight = true }: {
  code: string
  lang: string
  streaming: boolean
  highlight?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const text = useMemo(() => code, [code])
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
          <span className="code-lines">{`${lineCount} lines`}</span>
        )}
        <button
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? 'Copied to clipboard' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check size={12} />
              <span>{'Copied'}</span>
            </>
          ) : (
            'Copy'
          )}
        </button>
      </div>
      <div className="code-block-body">
        <pre><code className={lang ? `language-${lang}` : undefined}>{highlight && !streaming ? <ShikiCode code={text} language={lang} /> : text}</code></pre>
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
          {folded ? `Show all ${lineCount} lines` : 'Collapse'}
        </button>
      )}
    </div>
  )
}
