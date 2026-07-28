import { useState, useEffect, useCallback } from 'react'
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
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      <div className="file-browser" onClick={(e) => e.stopPropagation()}>
        <div className="fb-header">
          <h3>Select Folder</h3>
          <button className="fb-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
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
          {loading && <div className="fb-loading">Loading...</div>}
          {error && <div className="fb-error">{error}</div>}
          {!loading && (
            <>
              {currentPath !== '/' && (
                <div className="fb-entry parent" onClick={navigateUp}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                  <span>..</span>
                </div>
              )}
              {!error && entries.filter((e) => e.isDirectory).map((entry) => (
                <div key={entry.path} className="fb-entry folder" onClick={() => navigateTo(entry.path)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>{entry.name}</span>
                </div>
              ))}
              {!error && entries.filter((e) => !e.isDirectory).map((entry) => (
                <div key={entry.path} className="fb-entry file">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>{entry.name}</span>
                </div>
              ))}
              {entries.length === 0 && !error && (
                <div className="fb-empty">Empty directory</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="fb-footer">
          <span className="fb-current-path">{currentPath}</span>
          <div className="fb-actions">
            <button className="fb-btn cancel" onClick={onClose}>Cancel</button>
            <button className="fb-btn select" onClick={() => onSelect(currentPath)}>Select</button>
          </div>
        </div>
      </div>
    </div>
  )
}
