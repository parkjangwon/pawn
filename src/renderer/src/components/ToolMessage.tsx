import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import './ToolMessage.css'
import DiffView from './DiffView'
import { parseDiffMarker, stripDiffMarker } from '../utils/diffMarker'
import { openFileInPanel } from '../stores/filesPanel'
import { displayTarget, formatToolDuration, type ToolMeta } from '../agent/toolMeta'
import { toolLabel } from './toolLabels'
import { timelineStage } from './timelineStage'

/** Legacy rows embed the model-facing offload note in the content itself. */
const LEGACY_NOTE_RE = /\[full output: ([\d,]+) chars saved[^\]]*\]\s*$/
const PAGE_CHUNK = 16_000

interface ToolMessageProps {
  content: string
  /** Structured record (new rows); older rows fall back to parsing `content`. */
  meta?: ToolMeta
}

export default function ToolMessage({ content, meta }: ToolMessageProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [paged, setPaged] = useState<{ content: string; total: number; hasMore: boolean } | null>(null)
  const [paging, setPaging] = useState(false)

  // A __DIFF__: JSON marker (or the legacy block) carries the diff for DiffView.
  const diff = parseDiffMarker(content)
  const diffFilename = diff?.filename || ''
  const diffPath = diff?.path || ''
  const diffOld = diff?.oldText || ''
  const diffNew = diff?.newText || ''
  const displayContentBase = stripDiffMarker(content)

  // Offloaded output: structured on new rows (toolMeta.offloaded); legacy rows
  // carry the note inline — detect it and hide it from the visible body (the
  // note is a model instruction, not user copy).
  const noteMatch = !meta?.offloaded ? content.match(LEGACY_NOTE_RE) : null
  const offloaded = meta?.offloaded ?? (noteMatch
    ? {
        id: content.match(/"id":"([^"]+)"/)?.[1] ?? '',
        chars: Number((noteMatch[1] || '').replace(/,/g, '')) || 0
      }
    : undefined)
  const visibleBase = noteMatch
    ? displayContentBase.replace(LEGACY_NOTE_RE, '')
    : displayContentBase

  const loadOutputPage = async (offset: number, append: boolean): Promise<void> => {
    if (!offloaded?.id) return
    setPaging(true)
    try {
      const r = await window.api?.toolOutput?.get?.(offloaded.id, offset, PAGE_CHUNK)
      if (r?.ok && typeof r.content === 'string') {
        const chunk = r.content
        const total = typeof r.total === 'number' ? r.total : offloaded.chars
        const more = Boolean(r.hasMore)
        setPaged((prev) => ({
          content: prev && append ? prev.content + chunk : chunk,
          total,
          hasMore: more
        }))
      }
    } catch {
      /* keep current view */
    } finally {
      setPaging(false)
    }
  }

  const firstLine = content.split('\n')[0] || ''
  const toolMatch = firstLine.match(/\[Tool: (\w+)\] (\w+)/)
  const toolName = meta?.name || toolMatch?.[1] || firstLine.match(/\[Tool: (\w+)\]/)?.[1] || 'tool'
  const toolStatus = meta ? (meta.status === 'error' ? 'ERROR' : 'OK') : toolMatch?.[2] || 'running'
  const isError = toolStatus === 'ERROR'
  const isRunning = toolStatus === 'running'

  // Remaining content after first line
  const remaining = visibleBase.split('\n').slice(1).join('\n').trim()
  const truncated = remaining.length > 300 && !showAll
  const displayContent = showAll ? remaining : remaining.slice(0, 300)

  const structureWarn = remaining.includes('[structure_check:')
  const isSubagentTool =
    toolName === 'spawn_agent' ||
    toolName === 'parallel_agents' ||
    toolName === 'list_agents' ||
    toolName === 'await_agent' ||
    toolName === 'cancel_agent'

  const info = toolLabel(t, toolName)
  const target = meta ? displayTarget(meta) : undefined
  const hasLineStats = Boolean(meta && ((meta.added ?? 0) > 0 || (meta.removed ?? 0) > 0))
  const duration = meta && (meta.durationMs ?? 0) >= 1000 ? formatToolDuration(meta.durationMs) : undefined

  return (
    <div
      className={`tool-message ${isError ? 'tool-error' : ''} ${isRunning ? 'tool-running' : ''} ${structureWarn ? 'tool-structure-warn' : ''} ${isSubagentTool ? 'tool-subagent' : ''}`}
    >
      <div
        className="tool-message-header"
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
        <ChevronRight
          size={10}
          className={`tool-chevron ${collapsed ? '' : 'expanded'}`}
        />
        {info.icon && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="tool-icon">
            <path d={info.icon} />
          </svg>
        )}
        <span className={`tool-name timeline-pill timeline-pill-${timelineStage(toolName)}`}>{info.label}</span>
        {target && (
          <span className="tool-target" title={meta?.path || meta?.target}>
            {target}
          </span>
        )}
        {meta?.host && <span className="tool-host" title={`Runs on ${meta.host}`}>{meta.host}</span>}
        {hasLineStats && (
          <span className="tool-line-stats" aria-label={t('toolMessage.lineStats', { added: meta?.added ?? 0, removed: meta?.removed ?? 0 })}>
            {(meta?.added ?? 0) > 0 && <span className="tool-added">+{meta?.added}</span>}
            {(meta?.removed ?? 0) > 0 && <span className="tool-removed">−{meta?.removed}</span>}
          </span>
        )}
        {structureWarn && <span className="tool-badge-warn" title={t('toolMessage.structureHint')}>{t('toolMessage.structure')}</span>}
        {meta?.mod && (
          <span
            className={`tool-mod-badge ${meta.mod.action}`}
            title={
              meta.mod.action === 'blocked'
                ? t('chat.mods.toolBlocked', { plugin: meta.mod.plugin })
                : t('chat.mods.toolAnswered', { plugin: meta.mod.plugin })
            }
          >
            {meta.mod.plugin}
          </span>
        )}
        {duration && <span className="tool-duration">{duration}</span>}
        <span
          className={`tool-status ${isRunning ? 'running' : isError ? 'error' : 'ok'}`}
          title={isRunning ? undefined : isError ? t('toolMessage.statusError') : t('toolMessage.statusOk')}
        >
          {isRunning ? '⋯' : isError ? t('toolMessage.statusError') : t('toolMessage.statusOk')}
        </span>
      </div>
      {!collapsed && remaining && (
        <div className="tool-message-body">
          {diffFilename && (
            <div className="tool-diff-preview">
              <DiffView
                oldText={diffOld}
                newText={diffNew}
                filename={diffFilename}
                path={diffPath || undefined}
                maxLines={50}
              />
            </div>
          )}
          <pre className="tool-message-content">
            {displayContent ? linkifyCreatedFiles(displayContent) : t('toolMessage.empty')}
          </pre>
          {truncated && (
            <button className="tool-show-more" onClick={() => setShowAll(true)}>
              {t('toolMessage.showFullOutput')}
            </button>
          )}
          {showAll && remaining.length > 300 && (
            <button className="tool-show-more" onClick={() => setShowAll(false)}>
              {t('toolMessage.showLess')}
            </button>
          )}
          {offloaded && !paged && (
            <div className="tool-output-offloaded">
              <span className="tool-output-note">
                {t('chat.toolMessage.outputOffloaded', { chars: offloaded.chars })}
              </span>
              <button className="tool-show-more" disabled={paging || !offloaded.id} onClick={() => void loadOutputPage(0, false)}>
                {paging ? '…' : t('chat.toolMessage.loadFull')}
              </button>
            </div>
          )}
          {paged && (
            <>
              <pre className="tool-message-content tool-output-paged">{paged.content}</pre>
              {paged.hasMore ? (
                <button className="tool-show-more" disabled={paging} onClick={() => void loadOutputPage(paged.content.length, true)}>
                  {paging ? '…' : t('chat.toolMessage.loadMore')}
                </button>
              ) : (
                <span className="tool-output-total">{t('chat.toolMessage.fullShown', { chars: paged.total })}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Turn "File created/written/edited/deleted: <abs path>" lines into clickable
 * file:// links that reveal the file in Finder/Explorer, so users can jump to
 * session-generated files without copying the path.
 */
function linkifyCreatedFiles(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    const m = line.match(/^(File (?:created|written|edited|deleted): )(\S+)(.*)$/)
    const path = m?.[2]
    if (m && path && (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path))) {
      const trailing = m[3] || ''
      return (
        <span key={i}>
          {m[1]}
          <a
            className="tool-file-link"
            href={'file://' + path}
            title={path}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void Promise.resolve(window.api?.workspace?.reveal?.(path)).catch(() => {})
            }}
          >
            {path}
          </a>
          {trailing}
          {'\n'}
        </span>
      )
    }
    return <span key={i}>{line}{'\n'}</span>
  })
}
