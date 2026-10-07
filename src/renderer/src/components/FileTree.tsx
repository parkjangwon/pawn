import { useState, useEffect, useCallback } from 'react'
import { tx } from '../i18n'
import { ChevronRight, File, Folder } from 'lucide-react'
import './FileTree.css'

interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

interface FileTreeProps {
  rootPath: string
}

export default function FileTree({ rootPath }: FileTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({})
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!rootPath) { setEntries([]); setLoading(false); return }
    setLoading(true)
    window.api.fs.listDir(rootPath).then((result) => {
      if (Array.isArray(result)) {
        const sorted = result.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setEntries(sorted)
      }
    }).catch(() => setEntries([]))
    .finally(() => setLoading(false))
  }, [rootPath])

  const loadDir = useCallback(async (dirPath: string) => {
    if (childEntries[dirPath]) return
    const result = await window.api.fs.listDir(dirPath)
    if (Array.isArray(result)) {
      const sorted = result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setChildEntries((prev) => ({ ...prev, [dirPath]: sorted }))
    }
  }, [childEntries])

  const toggleDir = (dirPath: string): void => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
        loadDir(dirPath)
      }
      return next
    })
  }

  const getIcon = (entry: FileEntry): string => {
    if (entry.isDirectory) return 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
    const ext = entry.name.split('.').pop()?.toLowerCase()
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
    if (['css', 'scss', 'less'].includes(ext || '')) return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
    if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(ext || '')) return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
    if (['md', 'txt', 'rst'].includes(ext || '')) return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
    return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
  }

  if (!rootPath) return <></>

  const renderEntry = (entry: FileEntry, depth: number): React.JSX.Element | null => {
    const paddingLeft = 12 + depth * 14
    const isExpanded = expandedDirs.has(entry.path)
    const children = childEntries[entry.path]

    return (
      <div key={entry.path}>
        <div
          className={`ft-entry ${entry.isDirectory ? 'ft-dir' : 'ft-file'}`}
          style={{ paddingLeft }}
          onClick={() => entry.isDirectory && toggleDir(entry.path)}
        >
          {entry.isDirectory && (
            <ChevronRight
              size={8}
              className={`ft-chevron ${isExpanded ? 'expanded' : ''}`}
            />
          )}
          {!entry.isDirectory && <span className="ft-spacer" />}
          {entry.isDirectory
            ? <Folder size={13} className="ft-icon" />
            : <File size={13} className="ft-icon" />
          }
          <span className="ft-name">{entry.name}</span>
        </div>
        {isExpanded && children && children.map((child) => renderEntry(child, depth + 1))}
      </div>
    )
  }

  const rootName = rootPath.split('/').filter(Boolean).pop() || rootPath

  return (
    <div className="file-tree">
      <div
        className="ft-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(!collapsed)
          }
        }}
      >
        <ChevronRight size={10} className={`ft-chevron ${collapsed ? '' : 'expanded'}`} />
        <Folder size={12} />
        <span className="ft-root-name">{rootName}</span>
      </div>
      {!collapsed && (
        <div className="ft-body">
          {loading && <div className="ft-loading">{'Loading files…'}</div>}
          {!loading && entries.map((entry) => renderEntry(entry, 0))}
          {!loading && entries.length === 0 && <div className="ft-empty">{'No files to display'}</div>}
        </div>
      )}
    </div>
  )
}
