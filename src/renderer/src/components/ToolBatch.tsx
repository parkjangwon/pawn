import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ToolMessage from './ToolMessage'
import type { Message } from '../stores/app'
import './ToolBatch.css'

interface ToolBatchProps {
  messages: Message[]
  animateIn?: boolean
}

export default function ToolBatch({ messages, animateIn }: ToolBatchProps): React.JSX.Element {
  const { t } = useTranslation()

  // Single tool message fallback
  if (messages.length === 1) {
    const msg = messages[0]
    return (
      <div className={`message system${animateIn ? ' message-enter' : ''}`}>
        <ToolMessage content={msg.content} />
      </div>
    )
  }

  // Parse details from batch
  const parsedTools = useMemo(() => {
    return messages.map((m) => {
      const firstLine = m.content.split('\n')[0] || ''
      const toolMatch = firstLine.match(/\[Tool: (\w+)\] (\w+)/)
      const toolName = toolMatch?.[1] || firstLine.match(/\[Tool: (\w+)\]/)?.[1] || 'tool'
      const toolStatus = toolMatch?.[2] || 'running'
      const isError = toolStatus === 'ERROR'
      const isRunning = toolStatus === 'running'
      const hasDiff = m.content.includes('__DIFF__:')
      return {
        id: m.id,
        content: m.content,
        toolName,
        toolStatus,
        isError,
        isRunning,
        hasDiff
      }
    })
  }, [messages])

  const hasRunning = parsedTools.some((p) => p.isRunning)
  const hasError = parsedTools.some((p) => p.isError)
  const hasDiff = parsedTools.some((p) => p.hasDiff)

  // Default collapsed if finished, expanded if running or has errors
  const [expanded, setExpanded] = useState(hasRunning || hasError)

  // Tool counts summary: e.g. { read_file: 3, grep_search: 2 }
  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of parsedTools) {
      map[p.toolName] = (map[p.toolName] || 0) + 1
    }
    return map
  }, [parsedTools])

  return (
    <div className={`message system tool-batch-container${animateIn ? ' message-enter' : ''}`}>
      <div
        className={`tool-batch-card ${hasError ? 'batch-error' : ''} ${hasRunning ? 'batch-running' : ''}`}
      >
        <button
          type="button"
          className="tool-batch-header"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <div className="tool-batch-header-left">
            <span className="tool-batch-status-icon">
              {hasRunning ? (
                <span className="tool-batch-spinner" aria-hidden="true" />
              ) : hasError ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span className="tool-batch-title">
              {hasRunning
                ? t('toolMessage.batchRunning', { count: messages.length, defaultValue: `Running ${messages.length} tools...` })
                : t('toolMessage.batchDone', { count: messages.length, defaultValue: `Executed ${messages.length} operations` })}
            </span>
            <div className="tool-batch-chips">
              {Object.entries(counts).slice(0, 4).map(([name, count]) => (
                <span key={name} className="tool-batch-chip">
                  {name}
                  {count > 1 ? ` ×${count}` : ''}
                </span>
              ))}
              {Object.keys(counts).length > 4 && (
                <span className="tool-batch-chip more">+{Object.keys(counts).length - 4}</span>
              )}
            </div>
          </div>

          <div className="tool-batch-header-right">
            {hasDiff && (
              <span className="tool-batch-diff-badge" title="Files modified">
                Diff
              </span>
            )}
            <svg
              className={`tool-batch-chevron ${expanded ? 'expanded' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {expanded && (
          <div className="tool-batch-body">
            {messages.map((m) => (
              <div key={m.id} className="tool-batch-item">
                <ToolMessage content={m.content} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
