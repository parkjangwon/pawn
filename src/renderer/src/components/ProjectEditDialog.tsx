import { useState } from 'react'
import { useAppStore } from '../stores/app'
import FileBrowser from './FileBrowser'
import './ProjectEditDialog.css'

interface ProjectEditDialogProps {
  projectId?: string
  onClose: () => void
}

export default function ProjectEditDialog({ projectId, onClose }: ProjectEditDialogProps): React.JSX.Element {
  const { projects, addProject, updateProjectName, updateProjectPaths } = useAppStore()
  const existing = projectId ? projects.find((p) => p.id === projectId) : null

  const [name, setName] = useState(existing?.name || '')
  const [paths, setPaths] = useState<string[]>(existing?.paths || [])
  const [showFileBrowser, setShowFileBrowser] = useState(false)

  const handleSave = (): void => {
    if (!name.trim()) return
    if (existing) {
      updateProjectName(existing.id, name.trim())
      updateProjectPaths(existing.id, paths)
    } else {
      addProject(name.trim(), paths)
    }
    onClose()
  }

  const handleAddFolder = (): void => {
    setShowFileBrowser(true)
  }

  const handleFolderSelected = (path: string): void => {
    if (!paths.includes(path)) {
      setPaths([...paths, path])
    }
    setShowFileBrowser(false)
  }

  const handleRemovePath = (index: number): void => {
    setPaths(paths.filter((_, i) => i !== index))
  }

  return (
    <div className="ped-overlay" onClick={onClose}>
      <div className="ped-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ped-header">
          <h3>{existing ? '프로젝트 편집' : '새 프로젝트'}</h3>
          <button className="ped-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="ped-body">
          <div className="ped-field">
            <input
              className="ped-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="프로젝트 이름"
              autoFocus
            />
          </div>

          <div className="ped-field">
            <label className="ped-label">Source folders</label>
            <div className="ped-paths">
              {paths.map((p, i) => (
                <div key={i} className="ped-path-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  <span className="ped-path-text">{p.split('/').pop() || p}</span>
                  <span className="ped-path-full">{p}</span>
                  <button className="ped-path-remove" onClick={() => handleRemovePath(i)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
              <button className="ped-add-folder" onClick={handleAddFolder}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                <span>폴더 추가</span>
              </button>
            </div>
          </div>
        </div>

        <div className="ped-footer">
          {existing && (
            <button className="ped-btn danger" onClick={() => { useAppStore.getState().removeProject(existing.id); onClose() }}>
              프로젝트 삭제
            </button>
          )}
          <div className="ped-footer-right">
            <button className="ped-btn cancel" onClick={onClose}>취소</button>
            <button className="ped-btn save" onClick={handleSave} disabled={!name.trim()}>저장</button>
          </div>
        </div>
      </div>

      {showFileBrowser && (
        <FileBrowser initialPath="/" onSelect={handleFolderSelected} onClose={() => setShowFileBrowser(false)} />
      )}
    </div>
  )
}
