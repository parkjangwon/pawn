import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import ToolMessage from './ToolMessage'
import type { Message } from '../stores/app'
import { aggregateToolMeta, formatToolDuration } from '../agent/toolMeta'
import { toolLabel, toolLabelTable } from './toolLabels'
import './ToolBatch.css'

interface ToolBatchProps {
  messages: Message[]
  animateIn?: boolean
}

export default function ToolBatch({ messages, animateIn }: ToolBatchProps): React.JSX.Element {
  const { t } = useTranslation()

  // Parse details from batch
  const parsedTools = useMemo(() => {
    return messages.map((m) => {
      const firstLine = m.content.split('\n')[0] || ''
      const toolMatch = firstLine.match(/\[Tool: (\w+)\] (\w+)/)
      const toolName = m.toolMeta?.name || toolMatch?.[1] || firstLine.match(/\[Tool: (\w+)\]/)?.[1] || 'tool'
      const toolStatus = m.toolMeta ? (m.toolMeta.status === 'error' ? 'ERROR' : 'OK') : toolMatch?.[2] || 'running'
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

  const stats = useMemo(() => aggregateToolMeta(messages.map((m) => m.toolMeta)), [messages])
  const labels = useMemo(() => toolLabelTable(t), [t])
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

  // Single tool: plain row. Checked after all hooks so a batch growing from one
  // to two tools (same React key) keeps a stable hook order.
  if (messages.length === 1) {
    const msg = messages[0]
    return (
      <div className={`message system${animateIn ? ' message-enter' : ''}`} data-message-id={msg.id}>
        <ToolMessage content={msg.content} meta={msg.toolMeta} />
      </div>
    )
  }

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
                <CircleAlert size={13} />
              ) : (
                <Check size={13} />
              )}
            </span>
            <span className="tool-batch-title">
              {hasRunning
                ? t('toolMessage.batchRunning', { count: messages.length })
                : t('toolMessage.batchDone', { count: messages.length })}
            </span>
            <div className="tool-batch-chips">
              {Object.entries(counts).slice(0, 4).map(([name, count]) => (
                <span key={name} className="tool-batch-chip" title={toolLabel(t, name).label}>
                  {toolLabel(t, name, labels).label}
                  {count > 1 ? ` ×${count}` : ''}
                </span>
              ))}
              {Object.keys(counts).length > 4 && (
                <span className="tool-batch-chip more">+{Object.keys(counts).length - 4}</span>
              )}
            </div>
          </div>

          <div className="tool-batch-header-right">
            {stats.filesChanged > 0 && (
              <span className="tool-batch-lines" title={t('toolMessage.filesChanged', { count: stats.filesChanged })}>
                <span className="tool-batch-files">{t('toolMessage.filesChanged', { count: stats.filesChanged })}</span>
                {stats.added > 0 && <span className="tool-added">+{stats.added}</span>}
                {stats.removed > 0 && <span className="tool-removed">−{stats.removed}</span>}
              </span>
            )}
            {stats.durationMs >= 1000 && (
              <span className="tool-batch-duration">{formatToolDuration(stats.durationMs)}</span>
            )}
            {hasDiff && stats.filesChanged === 0 && (
              <span className="tool-batch-diff-badge" title={t('toolMessage.filesModified')}>
                {t('toolMessage.diffBadge')}
              </span>
            )}
            <ChevronDown
              size={12}
              className={`tool-batch-chevron ${expanded ? 'expanded' : ''}`}
            />
          </div>
        </button>

        {expanded && (
          <div className="tool-batch-body">
            {messages.map((m) => (
              <div key={m.id} className="tool-batch-item">
                <ToolMessage content={m.content} meta={m.toolMeta} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
