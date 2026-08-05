import { useTranslation } from 'react-i18next'
import { useArtifactsStore, type Artifact } from '../stores/artifacts'
import { openFileInPanel } from '../stores/filesPanel'
import './ArtifactsView.css'

function kindLabel(kind: Artifact['kind'], t: (k: string) => string): string {
  return t(`rightPanel.artifacts.kinds.${kind}`)
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

export default function ArtifactsView(): React.JSX.Element {
  const { t } = useTranslation()
  const { items, remove, clear } = useArtifactsStore()

  const openPath = (path: string): void => {
    openFileInPanel(path)
  }

  const reveal = async (path: string): Promise<void> => {
    try {
      // Finder/Explorer for project files; falls back to Pawn openPath for ~/.pawn reports.
      const r = await window.api.workspace?.openIn?.(path, 'finder')
      if (r && 'error' in r && r.error) {
        await window.api.workspace?.openPath?.(path)
      }
    } catch { /* ignore */ }
  }

  const copyPath = async (path: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path)
    } catch { /* ignore */ }
  }

  if (items.length === 0) {
    return (
      <div className="artifacts-empty">
        <div className="artifacts-empty-title">{t('rightPanel.artifacts.emptyTitle')}</div>
        <div className="artifacts-empty-desc">{t('rightPanel.artifacts.emptyDesc')}</div>
      </div>
    )
  }

  return (
    <div className="artifacts-view">
      <div className="artifacts-toolbar">
        <span className="artifacts-count">{t('rightPanel.artifacts.count', { count: items.length })}</span>
        <button type="button" className="artifacts-clear" onClick={() => clear()}>
          {t('rightPanel.artifacts.clear')}
        </button>
      </div>
      <div className="artifacts-list">
        {items.map((a) => (
          <div key={a.id} className="artifact-card">
            <div className="artifact-card-top">
              <span className="artifact-kind">{kindLabel(a.kind, t)}</span>
              <span className="artifact-time">{formatTime(a.createdAt)}</span>
            </div>
            <div className="artifact-title">{a.title}</div>
            {a.source && <div className="artifact-source">{a.source}</div>}
            {a.path && (
              <div className="artifact-path" title={a.path}>{a.path}</div>
            )}
            {a.preview && (
              <pre className="artifact-preview">{a.preview}</pre>
            )}
            <div className="artifact-actions">
              {a.path && (
                <>
                  <button type="button" onClick={() => openPath(a.path!)}>{t('rightPanel.artifacts.open')}</button>
                  <button type="button" onClick={() => void reveal(a.path!)}>{t('rightPanel.artifacts.reveal')}</button>
                  <button type="button" onClick={() => void copyPath(a.path!)}>{t('rightPanel.artifacts.copyPath')}</button>
                </>
              )}
              <button type="button" className="artifact-remove" onClick={() => remove(a.id)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
