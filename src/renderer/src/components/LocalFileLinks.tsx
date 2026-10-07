/**
 * Local files in chat markdown: links open inside Pawn (file viewer), images
 * render inline, and inline-code paths become clickable when the file exists.
 *
 * Paths resolve against the chat's working folder (project root, or the
 * General workspace), so `[a.ts](src/a.ts)`, `![](charts/x.png)`,
 * `file:///abs/a.ts` and `/abs/a.ts` all work. Images load through the main
 * process as data URLs — the renderer never fetches file: or remote images.
 */

import { createContext, useContext, useEffect, useState } from 'react'
import { tx } from '../i18n'
import { openFileInPanel } from '../stores/filesPanel'

/** Working folder relative chat paths resolve against. */
export const MarkdownBaseDirContext = createContext<string | null>(null)

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
/** Extensions that make a bare inline-code token worth checking on disk. */
const FILE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|txt|py|go|rs|java|kt|swift|rb|php|c|h|cc|cpp|hpp|cs|css|scss|less|html|vue|svelte|yaml|yml|toml|ini|env|sh|sql|csv|tsv|xml|svg|png|jpe?g|gif|webp|pdf|lock|log|gradle|proto|graphql|dockerfile)$/i

/** file:///Users/a.ts → /Users/a.ts; file:///C:/x.ts → C:/x.ts (Windows). */
export function decodeFilePath(href: string): string {
  let p = href.slice('file://'.length)
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  try {
    p = decodeURIComponent(p)
  } catch {
    /* keep raw */
  }
  return p
}

function normalizeJoin(base: string, rel: string): string {
  const parts = `${base.replace(/\/+$/, '')}/${rel}`.split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (seg === '.' || (seg === '' && out.length > 0)) continue
    if (seg === '..') {
      if (out.length > 1) out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/') || '/'
}

/** Strip `#L12`, `:12`, `:12:3` position suffixes. */
function stripPosition(p: string): string {
  return p.replace(/#L\d+(-L?\d+)?$/i, '').replace(/:\d+(:\d+)?$/, '')
}

/**
 * Absolute local path for a markdown href / src, or null when it is a web
 * URL, an anchor, or relative without a base folder.
 */
export function resolveLocalPath(href: string | undefined | null, baseDir: string | null): string | null {
  if (!href) return null
  const raw = href.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null
  if (/^file:/i.test(raw)) return stripPosition(decodeFilePath(raw.replace(/^file:(\/\/)?/i, 'file://')))
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) return null // other schemes
  let p = raw
  try {
    p = decodeURIComponent(raw)
  } catch {
    /* keep raw */
  }
  p = stripPosition(p)
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return p
  if (!baseDir) return null
  return normalizeJoin(baseDir, p.replace(/^\.\//, ''))
}

/** Does an inline-code token look like a file path worth checking? */
export function looksLikeFilePath(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 240 || /\s/.test(t) || /^[a-z]+:\/\//i.test(t)) return false
  if (/[<>{}()[\]"'`|;,*?]/.test(t)) return false
  return (t.includes('/') && /\.[A-Za-z0-9]{1,10}$/.test(t)) || FILE_EXT.test(t) || /(^|\/)(Makefile|Dockerfile)$/.test(t)
}

function toast(message: string): void {
  window.dispatchEvent(new CustomEvent('pawn:toast', { detail: { message } }))
}

type StatResult = { isFile: boolean; isDirectory: boolean } | null
const statCache = new Map<string, { at: number; value: StatResult }>()

async function statPath(path: string, maxAgeMs = 4000): Promise<StatResult> {
  const hit = statCache.get(path)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value
  let value: StatResult = null
  try {
    const s = await window.api?.fs?.stat?.(path)
    value = s && !('error' in s) ? { isFile: s.isFile, isDirectory: s.isDirectory } : null
  } catch {
    value = null
  }
  statCache.set(path, { at: Date.now(), value })
  return value
}

/** Open a local path inside Pawn (files → viewer, folders → Finder); ⌘/Ctrl-click reveals. */
export async function openLocalPath(path: string, opts: { reveal?: boolean; notFound: string }): Promise<void> {
  const st = await statPath(path, 0)
  if (!st) {
    toast(`${opts.notFound}: ${path}`)
    return
  }
  if (opts.reveal || st.isDirectory) {
    void Promise.resolve(window.api?.workspace?.reveal?.(path)).catch(() => {})
    return
  }
  openFileInPanel(path)
}

export function LocalFileLink({ path, children }: { path: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <a
      className="md-file-link"
      href={`file://${encodeURI(path)}`}
      title={`${path}\n${'Click to open in Pawn · ⌘/Ctrl-click to reveal in Finder'}`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void openLocalPath(path, { reveal: e.metaKey || e.ctrlKey, notFound: 'File not found' })
      }}
    >
      {children}
    </a>
  )
}

const imageCache = new Map<string, { at: number; dataUrl: string }>()

/** Inline preview of a local image (loaded through the main process). */
export function LocalImage({
  path,
  alt,
  onOpen
}: {
  path: string
  alt: string
  onOpen: (src: string, alt: string) => void
}): React.JSX.Element {
  const cached = imageCache.get(path)
  const [src, setSrc] = useState<string | null>(cached && Date.now() - cached.at < 5000 ? cached.dataUrl : null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const hit = imageCache.get(path)
    if (hit && Date.now() - hit.at < 5000) {
      setSrc(hit.dataUrl)
      return
    }
    const read = window.api?.fs?.readImage
    if (!read) {
      setError('Image preview is unavailable here')
      return
    }
    void read(path)
      .then((r) => {
        if (cancelled) return
        if ('dataUrl' in r) {
          imageCache.set(path, { at: Date.now(), dataUrl: r.dataUrl })
          setSrc(r.dataUrl)
          setError(null)
        } else {
          setError(r.error)
        }
      })
      .catch((err: unknown) => !cancelled && setError(String(err)))
    return () => {
      cancelled = true
    }
  }, [path])

  if (error) {
    return (
      <span className="md-image-missing" title={path}>
        {alt || path.split('/').pop()} — {error === 'File not found' ? 'File not found' : error}
      </span>
    )
  }
  if (!src) return <span className="md-image-loading" aria-label={'Loading image'} title={path} />
  return (
    <span className="md-local-image">
      <img
        className="md-inline-image"
        src={src}
        alt={alt}
        loading="lazy"
        title={`${path}\n${'Double-click to enlarge'}`}
        role="button"
        tabIndex={0}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpen(src, alt)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(src, alt)
          }
        }}
      />
      <LocalFileLink path={path}>
        <span className="md-image-caption">{path.split('/').pop()}</span>
      </LocalFileLink>
    </span>
  )
}

/** Inline `code` that names an existing file becomes a link to it. */
export function PathCode({ text, children }: { text: string; children?: React.ReactNode }): React.JSX.Element {
  const baseDir = useContext(MarkdownBaseDirContext)
  const path = looksLikeFilePath(text) ? resolveLocalPath(text, baseDir) : null
  const [exists, setExists] = useState(false)
  useEffect(() => {
    let cancelled = false
    setExists(false)
    if (!path) return
    void statPath(path).then((st) => !cancelled && setExists(!!st))
    return () => {
      cancelled = true
    }
  }, [path])
  if (!path || !exists) return <code>{children}</code>
  return (
    <LocalFileLink path={path}>
      <code className="md-path-code">{children}</code>
    </LocalFileLink>
  )
}

export { IMAGE_EXT }
