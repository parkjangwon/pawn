import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { languageForPath, highlightCode } from '../utils/syntaxHighlight'

interface FileEditorProps {
  filePath: string
  fileName: string
  onClose: () => void
}

// Cap reads so a multi-megabyte minified bundle can't freeze the panel.
const MAX_BYTES = 1_000_000

type Status = 'loading' | 'ready' | 'binary' | 'tooLarge' | 'error'

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
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const dirty = status === 'ready' && content !== original
  const language = useMemo(() => languageForPath(filePath), [filePath])

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
    void (async (): Promise<void> => {
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
    })()
    return () => {
      cancelled = true
    }
  }, [filePath])

  const save = useCallback(async (): Promise<void> => {
    if (!dirty || saving) return
    setSaving(true)
    const res = await window.api.fs.writeFile(filePath, content)
    setSaving(false)
    if (res && res.error) {
      setStatus('error')
      setErrorMsg(res.error)
      return
    }
    setOriginal(content)
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1500)
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )

  if (status !== 'ready') {
    return (
      <div className="rp-file-editor">
        <div className="rp-fe-header">
          <button className="rp-fe-btn" onClick={onClose} title={t('fileEditor.back')}>
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
        <button className="rp-fe-btn" onClick={onClose} title={t('fileEditor.back')}>
          {chevron}
        </button>
        <span className={`rp-fe-name ${dirty ? 'is-dirty' : ''}`} title={filePath}>
          {dirty && <span className="rp-fe-dot" />}
          {fileName}
        </span>
        <div className="rp-fe-spacer" />
        <span className="rp-fe-meta">{lineCount} {t('fileEditor.linesUnit')}</span>
        <button
          className={`rp-fe-btn ${wrap ? 'is-active' : ''}`}
          onClick={() => setWrap((w) => !w)}
          title={t('fileEditor.wrap')}
          aria-pressed={wrap}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <path d="M6 20H4a2 2 0 0 1-2-2V9" />
            <path d="M18 20h2a2 2 0 0 0 2-2V9" />
            <polyline points="12 13 9 16 12 19" />
            <line x1="9" y1="16" x2="15" y2="16" />
          </svg>
        </button>
        <button className="rp-fe-save" onClick={save} disabled={!dirty || saving}>
          {saving ? t('fileEditor.saving') : savedFlash ? t('fileEditor.saved') : t('common.save')}
        </button>
      </div>
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
    </div>
  )
}
