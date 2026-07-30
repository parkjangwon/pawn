import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './ToolMessage.css'
import DiffView from './DiffView'

interface ToolMessageProps {
  content: string
}

export default function ToolMessage({ content }: ToolMessageProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // Parse tool name and result
  // Peel off an inline <<<DIFF:...>>> marker so we can render a DiffView
  const diffMatch = content.match(/<<<DIFF:(.+)>>>\n--- old\n([\s\S]*?)\n\+\+\+ new\n([\s\S]*?)<<<END>>>/)
  const diffFilename = diffMatch?.[1] || ''
  const diffOld = diffMatch?.[2] || ''
  const diffNew = diffMatch?.[3] || ''
  const displayContentBase = diffMatch ? content.replace(diffMatch[0], '').trim() : content

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

  const toolLabels: Record<string, { icon: string; label: string }> = {
    read_file: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', label: t('toolMessage.read') },
    write_file: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', label: t('toolMessage.write') },
    edit_file: { icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', label: t('toolMessage.edit') },
    list_dir: { icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', label: t('toolMessage.list') },
    shell_exec: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.shell') },
    computer_screenshot: { icon: 'M11 4a2 2 0 118 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z', label: t('toolMessage.screenshot') },
    computer_click: { icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', label: t('toolMessage.click') },
    computer_type: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: t('toolMessage.type') },
    browser_open: { icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', label: t('toolMessage.browser') }
  }

  const info = toolLabels[toolName] || { icon: '', label: toolName }

  return (
    <div className={`tool-message ${isError ? 'tool-error' : ''} ${isRunning ? 'tool-running' : ''}`}>
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
        <span className={`tool-status ${isRunning ? 'running' : isError ? 'error' : 'ok'}`}>
          {isRunning ? '⋯' : isError ? 'ERR' : 'OK'}
        </span>
      </div>
      {!collapsed && remaining && (
        <div className="tool-message-body">
          {diffFilename && (
            <div className="tool-diff-preview">
              <DiffView oldText={diffOld} newText={diffNew} filename={diffFilename} maxLines={50} />
            </div>
          )}
          <pre className="tool-message-content">
            {displayContent || '(empty)'}
          </pre>
          {truncated && (
            <button className="tool-show-more" onClick={() => setShowAll(true)}>
              Show full output...
            </button>
          )}
          {showAll && remaining.length > 300 && (
            <button className="tool-show-more" onClick={() => setShowAll(false)}>
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}
