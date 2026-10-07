import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, WrapText } from 'lucide-react'
import { languageForPath, highlightCode } from '../utils/syntaxHighlight'
import ConfirmDialog from './ConfirmDialog'
import MarkdownRenderer from './MarkdownRenderer'
import { MarkdownBaseDirContext } from './LocalFileLinks'

interface FileEditorProps {
  filePath: string
  fileName: string
  onClose: () => void
}

// Cap reads so a multi-megabyte minified bundle can't freeze the panel.
const MAX_BYTES = 1_000_000

type Status = 'loading' | 'ready' | 'image' | 'binary' | 'tooLarge' | 'error'

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i

/** Directory of a path, for resolving relative links/images in the preview. */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : ''
}

function isProbablyBinary(str: string): boolean {
  if (str.includes('\u0000')) return true
  const sample = str.length > 8000 ? str.slice(0, 8000) : str
  let control = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    // Control chars other than \t \n \r are a strong binary signal.
    if (code < 9 || (code > 13 && code < 32)) control++
  }
  return control / sample.length > 0.01
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FileEditor({ filePath, fileName, onClose }: FileEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  /** SVG: show the markup instead of the rendered image. */
  const [showSource, setShowSource] = useState(false)
  /** Markdown: render a formatted preview instead of the editor. */
  const [preview, setPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const dirty = status === 'ready' && content !== original
  const language = useMemo(() => languageForPath(filePath), [filePath])
  const isMarkdown = useMemo(() => MARKDOWN_FILE.test(filePath), [filePath])

  // Highlighted HTML for the overlay layer. The trailing-space append keeps the
  // final blank line aligned with the textarea when the file ends in a newline.
  const highlighted = useMemo(() => {
    const html = highlightCode(content, language)
    return content.endsWith('\n') ? html + ' ' : html
  }, [content, language])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setContent('')
    setOriginal('')
    setPreview(false)
    void (async (): Promise<void> => {
      try {
        const stat = await window.api.fs.stat(filePath)
        if (cancelled) return
        if (stat && 'error' in stat) {
          setStatus('error')
          setErrorMsg(stat.error)
          return
        }
        if (!stat.isFile) {
          setStatus('error')
          setErrorMsg('not a file')
          return
        }
        setFileSize(stat.size)
        // Images preview instead of showing "binary file".
        if (IMAGE_FILE.test(filePath) && !showSource && window.api.fs.readImage) {
          const img = await window.api.fs.readImage(filePath)
          if (cancelled) return
          if ('dataUrl' in img) {
            setImageSrc(img.dataUrl)
            setStatus('image')
            return
          }
        }
        if (stat.size > MAX_BYTES) {
          setStatus('tooLarge')
          return
        }
        const res = await window.api.fs.readFile(filePath)
        if (cancelled) return
        if (typeof res !== 'string') {
          setStatus('error')
          setErrorMsg(res?.error || 'read failed')
          return
        }
        if (isProbablyBinary(res)) {
          setStatus('binary')
          return
        }
        setContent(res)
        setOriginal(res)
        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setErrorMsg(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filePath, showSource])

  const save = useCallback(async (): Promise<void> => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const res = await window.api.fs.writeFile(filePath, content)
      if (res && res.error) {
        setStatus('error')
        setErrorMsg(res.error)
        return
      }
      setOriginal(content)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      // Without this finally a rejected write leaves the editor stuck in
      // "saving" forever.
      setSaving(false)
    }
  }, [content, dirty, filePath, saving])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
      return
    }
    if (e.key === 'Tab') {
      // Insert two spaces and keep the caret inside the inserted block.
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = content.slice(0, start) + '  ' + content.slice(end)
      setContent(next)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }

  const requestClose = (): void => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // The textarea owns the scroll; the highlight overlay and gutter mirror it so
  // colors and line numbers stay locked to the caret position.
  const syncScroll = (): void => {
    if (!taRef.current) return
    const { scrollTop, scrollLeft } = taRef.current
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop
      preRef.current.scrollLeft = scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop
  }

  const lineCount = content.split('\n').length
  const chevron = (
    <ChevronLeft size={14} />
  )

  if (status === 'image' && imageSrc) {
    return (
      <div className="rp-file-editor">
        <div className="rp-fe-header">
          <button className="rp-fe-btn" onClick={requestClose} title={t('fileEditor.back')} aria-label={t('fileEditor.back')}>
            {chevron}
          </button>
          <span className="rp-fe-name" title={filePath}>{fileName}</span>
          <div className="rp-fe-spacer" />
          <span className="rp-fe-meta">{humanSize(fileSize)}</span>
          {/\.svg$/i.test(filePath) && (
            <button className="rp-fe-btn rp-fe-text-btn" onClick={() => setShowSource(true)}>
              {t('fileEditor.viewSource')}
            </button>
          )}
          <button className="rp-fe-btn rp-fe-text-btn" onClick={() => window.api?.workspace?.reveal?.(filePath)?.catch?.(() => {})}>
            {t('fileEditor.reveal')}
          </button>
        </div>
        <div className="rp-fe-image">
          <img src={imageSrc} alt={fileName} />
        </div>
      </div>
    )
  }

  if (status !== 'ready') {
    return (
      <div className="rp-file-editor">
        <div className="rp-fe-header">
          <button className="rp-fe-btn" onClick={requestClose} title={t('fileEditor.back')}>
            {chevron}
          </button>
          <span className="rp-fe-name" title={filePath}>{fileName}</span>
        </div>
        <div className="rp-fe-status">
          {status === 'loading' && t('common.loading')}
          {status === 'binary' && t('fileEditor.binary')}
          {status === 'tooLarge' &&
            `${t('fileEditor.tooLarge', { max: humanSize(MAX_BYTES) })} (${humanSize(fileSize)})`}
          {status === 'error' && (
            <span className="rp-fe-error">
              {t('fileEditor.readError')}
              {errorMsg ? `: ${errorMsg}` : ''}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rp-file-editor">
      <div className="rp-fe-header">
        <button className="rp-fe-btn" onClick={requestClose} title={t('fileEditor.back')}>
          {chevron}
        </button>
        <span className={`rp-fe-name ${dirty ? 'is-dirty' : ''}`} title={filePath}>
          {dirty && <span className="rp-fe-dot" />}
          {fileName}
        </span>
        <div className="rp-fe-spacer" />
        <span className="rp-fe-meta">{lineCount} {t('fileEditor.linesUnit')}</span>
        {isMarkdown && (
          <button
            className={`rp-fe-btn rp-fe-text-btn ${preview ? 'is-active' : ''}`}
            onClick={() => setPreview((p) => !p)}
            title={preview ? t('fileEditor.viewCode') : t('fileEditor.preview')}
            aria-pressed={preview}
          >
            {preview ? t('fileEditor.viewCode') : t('fileEditor.preview')}
          </button>
        )}
        {!preview && (
          <button
            className={`rp-fe-btn ${wrap ? 'is-active' : ''}`}
            onClick={() => setWrap((w) => !w)}
            title={t('fileEditor.wrap')}
            aria-pressed={wrap}
          >
            <WrapText size={14} />
          </button>
        )}
        <button className="rp-fe-save" onClick={save} disabled={!dirty || saving}>
          {saving ? t('fileEditor.saving') : savedFlash ? t('fileEditor.saved') : t('common.save')}
        </button>
      </div>
      {preview ? (
        <div className="rp-fe-body rp-fe-preview">
          <MarkdownBaseDirContext.Provider value={dirOf(filePath)}>
            <MarkdownRenderer content={content} />
          </MarkdownBaseDirContext.Provider>
        </div>
      ) : (
      <div className="rp-fe-body">
        {/* With wrapping, a logical line spans multiple rows and the per-line
            gutter can't track 1:1, so line numbers only render in nowrap mode. */}
        {!wrap && (
          <div className="rp-fe-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="rp-fe-ln">{i + 1}</div>
            ))}
          </div>
        )}
        <div className="rp-fe-editor-wrap">
          <pre className={`rp-fe-highlight ${wrap ? 'wrap' : 'nowrap'}`} ref={preRef} aria-hidden="true">
            <code
              className={language ? `hljs language-${language}` : 'hljs'}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
          <textarea
            ref={taRef}
            className={`rp-fe-textarea ${wrap ? 'wrap' : 'nowrap'}`}
            wrap={wrap ? 'soft' : 'off'}
            value={content}
            spellCheck={false}
            autoFocus
            onScroll={syncScroll}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      )}
      {confirmClose && (
        <ConfirmDialog
          title={t('fileEditor.unsavedTitle')}
          message={t('fileEditor.unsavedConfirm')}
          confirmLabel={t('fileEditor.discard')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { setConfirmClose(false); onClose() }}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  )
}
