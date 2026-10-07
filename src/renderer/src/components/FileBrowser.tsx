import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, File, Folder, X } from 'lucide-react'
import { useModalDialog } from '../utils/focusTrap'
import './FileBrowser.css'

interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

interface FileBrowserProps {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}

export default function FileBrowser({ initialPath, onSelect, onClose }: FileBrowserProps): React.JSX.Element {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalDialog(true, dialogRef, onClose)

  const loadDir = useCallback(async (path: string, fallback = true) => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.fs.listDir(path)
      if (Array.isArray(result)) {
        const sorted = result.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setEntries(sorted)
        setCurrentPath(path)
      } else {
        // Directory doesn't exist - try parent
        if (fallback && path !== '/') {
          const parent = path.replace(/\/[^/]+\/?$/, '') || '/'
          loadDir(parent, false)
          return
        }
        setError((result as { error: string }).error || 'Cannot read directory')
        setCurrentPath(path)
        setEntries([])
      }
    } catch (err) {
      if (fallback && path !== '/') {
        const parent = path.replace(/\/[^/]+\/?$/, '') || '/'
        loadDir(parent, false)
        return
      }
      setError(String(err))
      setCurrentPath(path)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDir(currentPath)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const navigateUp = (): void => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/'
    loadDir(parent)
  }

  const navigateTo = (path: string): void => {
    loadDir(path)
  }

  const pathParts = currentPath.split('/').filter(Boolean)

  return (
    <div className="file-browser-overlay" onClick={onClose}>
      <div ref={dialogRef} className="file-browser" role="dialog" aria-modal="true" aria-labelledby="fb-title" onClick={(e) => e.stopPropagation()}>
        <div className="fb-header">
          <h3 id="fb-title">{t("fileBrowser.title")}</h3>
          <button type="button" className="fb-close" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <X size={14} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="fb-breadcrumb">
          <button className="fb-crumb" onClick={() => navigateTo('/')}>/</button>
          {pathParts.map((part, i) => (
            <span key={i}>
              <span className="fb-crumb-sep">/</span>
              <button
                className="fb-crumb"
                onClick={() => navigateTo('/' + pathParts.slice(0, i + 1).join('/'))}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* File list */}
        <div className="fb-list">
          {loading && <div className="fb-loading">{t("common.loading")}</div>}
          {error && <div className="fb-error">{error}</div>}
          {!loading && (
            <>
              {currentPath !== '/' && (
                <div
                  className="fb-entry parent"
                  role="button"
                  tabIndex={0}
                  onClick={navigateUp}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigateUp()
                    }
                  }}
                >
                  <ChevronLeft size={14} />
                  <span>{t("fileBrowser.parent")}</span>
                </div>
              )}
              {!error && entries.filter((e) => e.isDirectory).map((entry) => (
                <div
                  key={entry.path}
                  className="fb-entry folder"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigateTo(entry.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigateTo(entry.path)
                    }
                  }}
                >
                  <Folder size={14} />
                  <span>{entry.name}</span>
                </div>
              ))}
              {!error && entries.filter((e) => !e.isDirectory).map((entry) => (
                <div key={entry.path} className="fb-entry file">
                  <File size={14} />
                  <span>{entry.name}</span>
                </div>
              ))}
              {entries.length === 0 && !error && (
                <div className="fb-empty">{t("fileBrowser.empty")}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="fb-footer">
          <span className="fb-current-path">{currentPath}</span>
          <div className="fb-actions">
            <button className="fb-btn cancel" onClick={onClose}>{t("fileBrowser.cancel")}</button>
            <button className="fb-btn select" onClick={() => onSelect(currentPath)}>{t("fileBrowser.select")}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
