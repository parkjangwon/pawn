import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useEffectiveTheme } from '../stores/theme'
import FileBrowser from './FileBrowser'
import ConfirmDialog from './ConfirmDialog'
import './ProjectEditDialog.css'

interface ProjectEditDialogProps {
  projectId?: string
  onClose: () => void
}

export default function ProjectEditDialog({ projectId, onClose }: ProjectEditDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useEffectiveTheme()
  const { projects, addProject, updateProjectName, updateProjectPaths } = useAppStore()
  const existing = projectId ? projects.find((p) => p.id === projectId) : null

  const [name, setName] = useState(existing?.name || '')
  const [paths, setPaths] = useState<string[]>(existing?.paths || [])
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  const handleAddFolder = async (): Promise<void> => {
    // Native folder picker (Finder-style) in the desktop app; the in-app file
    // browser is only a fallback for dev:web, where no native dialog exists.
    if (window.api.platform === 'browser') {
      setShowFileBrowser(true)
      return
    }
    const folder = await window.api.selectFolder()
    if (folder) handleFolderSelected(folder)
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

  // Portaled out of the sidebar (z-index: 10) so the overlay's z-index actually
  // sits above the chat area; otherwise the modal stack is capped at 10 and
  // bright chat elements (z-index 20+) stay visible above the dim layer.
  return createPortal(
    // The portal escapes the sidebar's stacking context; carrying the theme
    // class keeps the dialog opaque (the CSS variables live on .app.light/.dark).
    <div className={`app ${theme}`}>
      <div className="ped-overlay" onClick={onClose}>
        <div className="ped-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="ped-header">
            <h3>{existing ? t("projectEdit.edit") : t("projectEdit.create")}</h3>
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
                placeholder={t("projectEdit.namePlaceholder")}
                autoFocus
              />
            </div>

            <div className="ped-field">
              <label className="ped-label">{t("projectEdit.sourceFolders")}</label>
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
                  <span>{t("projectEdit.addFolder")}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="ped-footer">
            {existing && (
              <button className="ped-btn danger" onClick={() => setShowDeleteConfirm(true)}>
                {t("projectEdit.delete")}
              </button>
            )}
            <div className="ped-footer-right">
              <button className="ped-btn cancel" onClick={onClose}>{t("common.cancel")}</button>
              <button className="ped-btn save" onClick={handleSave} disabled={!name.trim()}>{t("common.save")}</button>
            </div>
          </div>
        </div>

        {showFileBrowser && (
          <FileBrowser initialPath="/" onSelect={handleFolderSelected} onClose={() => setShowFileBrowser(false)} />
        )}

        {showDeleteConfirm && existing && (
          <ConfirmDialog
            title={`${existing.name} ${t('common.delete')}`}
            message={t('sidebar.deleteProjectConfirm')}
            confirmLabel={t('confirmDialog.confirm')}
            cancelLabel={t('confirmDialog.cancel')}
            onConfirm={() => { useAppStore.getState().removeProject(existing.id); setShowDeleteConfirm(false); onClose() }}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}
      </div>
    </div>,
    document.body
  )
}
