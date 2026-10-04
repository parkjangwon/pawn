import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStreamingStore } from '../stores/streaming'
import './LiveToolActivity.css'

interface LiveToolActivityProps {
  sessionId: string
}

/**
 * Compact live card for a foreground shell command currently executing in the
 * session: label, elapsed seconds, a scrolling output tail and the line count.
 * Backed by the streaming store's `liveTool` slot (per session) — it never
 * touches the persisted transcript. Renders nothing when no command is live.
 */
export default function LiveToolActivity({ sessionId }: LiveToolActivityProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const live = useStreamingStore((s) => s.liveTool[sessionId])
  const hasLive = Boolean(live)
  const [now, setNow] = useState(() => Date.now())
  const preRef = useRef<HTMLPreElement | null>(null)

  // Elapsed-seconds tick — keyed on presence (not object identity, which
  // changes with every poll update) so the interval survives live updates.
  useEffect(() => {
    if (!hasLive) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasLive])

  // Keep the tail pinned to the bottom as new lines arrive.
  useEffect(() => {
    const pre = preRef.current
    if (pre) pre.scrollTop = pre.scrollHeight
  }, [live?.tail])

  if (!live) return null

  const seconds = Math.max(0, Math.floor((now - live.startedAt) / 1000))

  return (
    <div className="live-tool-activity" role="status">
      <div className="live-tool-activity-head">
        <span className="live-tool-activity-dot" aria-hidden="true" />
        <span className="live-tool-activity-title">
          {t('chat.liveTool.title', { label: live.label })}
        </span>
        {live.target && <span className="live-tool-activity-target">{live.target}</span>}
        <span className="live-tool-activity-elapsed">
          {t('chat.liveTool.running', { label: live.label, seconds })}
        </span>
      </div>
      <pre ref={preRef} className="live-tool-activity-tail">
        {live.tail || ' '}
      </pre>
      <div className="live-tool-activity-foot">
        {t('chat.liveTool.output', { count: live.totalLines })}
      </div>
    </div>
  )
}
