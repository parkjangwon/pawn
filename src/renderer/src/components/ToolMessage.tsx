import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './ToolMessage.css'
import DiffView from './DiffView'
import { parseDiffMarker, stripDiffMarker } from '../utils/diffMarker'
import { openFileInPanel } from '../stores/filesPanel'

interface ToolMessageProps {
  content: string
}

export default function ToolMessage({ content }: ToolMessageProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // A __DIFF__: JSON marker (or the legacy block) carries the diff for DiffView.
  const diff = parseDiffMarker(content)
  const diffFilename = diff?.filename || ''
  const diffPath = diff?.path || ''
  const diffOld = diff?.oldText || ''
  const diffNew = diff?.newText || ''
  const displayContentBase = stripDiffMarker(content)

  const firstLine = content.split('\n')[0] || ''
  const toolMatch = firstLine.match(/\[Tool: (\w+)\] (\w+)/)
  const toolName = toolMatch?.[1] || firstLine.match(/\[Tool: (\w+)\]/)?.[1] || 'tool'
  const toolStatus = toolMatch?.[2] || 'running'
  const isError = toolStatus === 'ERROR'
  const isRunning = toolStatus === 'running'

  // Remaining content after first line
  const remaining = displayContentBase.split('\n').slice(1).join('\n').trim()
  const truncated = remaining.length > 300 && !showAll
  const displayContent = showAll ? remaining : remaining.slice(0, 300)

  const structureWarn = remaining.includes('[structure_check:')
  const isSubagentTool =
    toolName === 'spawn_agent' ||
    toolName === 'parallel_agents' ||
    toolName === 'list_agents' ||
    toolName === 'await_agent' ||
    toolName === 'cancel_agent'

  const toolLabels: Record<string, { icon: string; label: string }> = {
    read_file: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', label: t('toolMessage.read') },
    write_file: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', label: t('toolMessage.write') },
    edit_file: { icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', label: t('toolMessage.edit') },
    delete_file: { icon: 'M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2', label: t('toolMessage.delete') },
    list_dir: { icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', label: t('toolMessage.list') },
    shell_exec: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.shell') },
    shell_poll: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.shellPoll') },
    shell_kill: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.shellKill') },
    git_status: { icon: 'M6 3v12M18 9a3 3 0 11-6 0 3 3 0 016 0zM6 15a3 3 0 100 6 3 3 0 000-6z', label: t('toolMessage.gitStatus') },
    git_diff: { icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6', label: t('toolMessage.gitDiff') },
    git_log: { icon: 'M12 8v4l3 3', label: t('toolMessage.gitLog') },
    git_add: { icon: 'M12 5v14M5 12h14', label: t('toolMessage.gitAdd') },
    git_commit: { icon: 'M12 8v4l3 3', label: t('toolMessage.gitCommit') },
    git_push: { icon: 'M12 19V5M5 12l7-7 7 7', label: t('toolMessage.gitPush') },
    git_branch: { icon: 'M6 3v12M18 9a3 3 0 11-6 0 3 3 0 016 0z', label: t('toolMessage.gitBranch') },
    git_stash: { icon: 'M21 8v13H3V8M1 3h22v5H1z', label: t('toolMessage.gitStash') },
    spawn_agent: { icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', label: t('toolMessage.subagent') },
    parallel_agents: { icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', label: t('toolMessage.parallelAgents') },
    list_agents: { icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', label: t('toolMessage.listAgents') },
    await_agent: { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: t('toolMessage.awaitAgent') },
    cancel_agent: { icon: 'M18 6L6 18M6 6l12 12', label: t('toolMessage.cancelAgent') },
    update_plan: { icon: 'M9 11l3 3L22 4', label: t('toolMessage.plan') },
    computer_screenshot: { icon: 'M11 4a2 2 0 118 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z', label: t('toolMessage.screenshot') },
    computer_displays: { icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', label: t('toolMessage.displays') },
    computer_click: { icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', label: t('toolMessage.click') },
    computer_move: { icon: 'M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122', label: t('toolMessage.move') },
    computer_drag: { icon: 'M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11', label: t('toolMessage.drag') },
    computer_scroll: { icon: 'M19 13l-7 7-7-7m14-8l-7 7-7-7', label: t('toolMessage.scroll') },
    computer_type: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.type') },
    computer_keypress: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.keypress') },
    computer_clipboard: { icon: 'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3', label: t('toolMessage.clipboard') },
    computer_wait: { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: t('toolMessage.wait') },
    browser_open: { icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', label: t('toolMessage.browser') }
  }

  const info = toolLabels[toolName] || { icon: '', label: toolName }

  return (
    <div
      className={`tool-message ${isError ? 'tool-error' : ''} ${isRunning ? 'tool-running' : ''} ${structureWarn ? 'tool-structure-warn' : ''} ${isSubagentTool ? 'tool-subagent' : ''}`}
    >
      <div className="tool-message-header" onClick={() => setCollapsed(!collapsed)}>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`tool-chevron ${collapsed ? '' : 'expanded'}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {info.icon && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="tool-icon">
            <path d={info.icon} />
          </svg>
        )}
        <span className="tool-name">{info.label}</span>
        {structureWarn && <span className="tool-badge-warn" title="Structure check warnings">structure</span>}
        <span className={`tool-status ${isRunning ? 'running' : isError ? 'error' : 'ok'}`}>
          {isRunning ? '⋯' : isError ? 'ERR' : 'OK'}
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
