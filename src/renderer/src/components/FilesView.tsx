import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import FileEditor from './FileEditor'
import { useFilesPanelStore } from '../stores/filesPanel'

interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

interface FilesViewProps {
  projectPath: string
}

export default function FilesView({ projectPath }: FilesViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({})
  const [loading, setLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null)

  useEffect(() => {
    if (!projectPath) { setRootEntries([]); setCurrentPath(''); return }
    setCurrentPath(projectPath)
    setLoading(true)
    loadDir(projectPath).then(setRootEntries).catch(() => setRootEntries([])).finally(() => setLoading(false))
  }, [projectPath])

  const loadDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    const result = await window.api.fs.listDir(dirPath)
    if (!Array.isArray(result)) return []
    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [])

  const toggleDir = useCallback(async (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
        if (!childEntries[dirPath]) {
          loadDir(dirPath).then((entries) => {
            setChildEntries((p) => ({ ...p, [dirPath]: entries }))
          })
        }
      }
      return next
    })
  }, [childEntries, loadDir])

  // Selecting a project root reloads the tree; the editor is per-file and
  // should not linger when the user switches projects.
  useEffect(() => {
    setSelectedFile(null)
  }, [projectPath])

  const pendingPath = useFilesPanelStore((s) => s.pendingPath)
  const pendingToken = useFilesPanelStore((s) => s.token)
  useEffect(() => {
    if (!pendingPath) return
    const name = pendingPath.split('/').pop() || pendingPath
    setSelectedFile({ path: pendingPath, name })
    useFilesPanelStore.getState().consume()
  }, [pendingPath, pendingToken])

  const openFile = useCallback((entry: FileEntry): void => {
    setSelectedFile({ path: entry.path, name: entry.name })
  }, [])

  const renderEntry = (entry: FileEntry, depth: number, entries: FileEntry[]): React.JSX.Element | null => {
    if (entry.isDirectory && entry.name.startsWith('.')) return null
    if (!entry.isDirectory && /node_modules|\.git|dist|out|\.next/.test(entry.path)) return null
    const paddingLeft = 8 + depth * 14
    const isExpanded = expandedDirs.has(entry.path)
    const children = childEntries[entry.path]

    return (
      <div key={entry.path}>
        <div
          className="rp-git-file"
          style={{ paddingLeft }}
          onClick={() => (entry.isDirectory ? toggleDir(entry.path) : openFile(entry))}
        >
          {entry.isDirectory ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          )}
          <span className="rp-git-file-name">{entry.name}</span>
        </div>
        {isExpanded && children && children.map((child) => renderEntry(child, depth + 1, children))}
      </div>
    )
  }

  if (!projectPath) return <div className="rp-files-empty">No project selected</div>

  if (selectedFile) {
    return (
      <FileEditor
        filePath={selectedFile.path}
        fileName={selectedFile.name}
        onClose={() => setSelectedFile(null)}
      />
    )
  }

  return (
    <div className="rp-files">
      <div className="rp-files-header">
        <span>{currentPath.split('/').filter(Boolean).pop() || 'root'}</span>
      </div>
      <div className="rp-files-body">
        {loading && <div className="rp-files-empty">{t('common.loading')}</div>}
        {!loading && rootEntries.map((entry) => renderEntry(entry, 0, rootEntries))}
        {!loading && rootEntries.length === 0 && <div className="rp-files-empty">{t('fileTree.empty')}</div>}
      </div>
    </div>
  )
}
