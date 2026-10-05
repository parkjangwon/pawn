import React, { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownRenderer from './MarkdownRenderer'
import SkillDraftCard from './SkillDraftCard'
import { splitSkillAnswer } from '../agent/recordReplay'
import ToolMessage from './ToolMessage'
import ToolBatch from './ToolBatch'
import SubagentActivity from './SubagentActivity'
import LiveToolActivity from './LiveToolActivity'
import ErrorCard from './ErrorCard'
import { useStreamingStore } from '../stores/streaming'
import { useChatStore } from '../stores/chat'
import { useModsUiStore } from '../agent/mods/uiStore'
import { stripDisplayImages } from '../utils/attachments'
import { formatDuration, formatMessageTime, formatMessageTimeFull, normalizeTimestampMs } from '../utils/messageTime'
import type { Message } from '../stores/app'
import { openAutomationDraft } from '../stores/automationDraft'

/** Localized fallback for a message whose markdown crashed the renderer. */
function RenderErrorText({ error }: { error: Error | null }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span>
      {t('chat.messageRenderFailed', { error: error?.message || 'render error' })}
    </span>
  )
}

class MessageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null }
  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
    return { hasError: true, error }
  }
  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="message message-render-error" style={{ opacity: 0.8, fontSize: '12px', padding: '8px 12px' }}>
          <span>⚠ <RenderErrorText error={this.state.error} /></span>
        </div>
      )
    }
    return this.props.children
  }
}

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  endRef: React.RefObject<HTMLDivElement | null>
  startIndex: number
  nearTop: boolean
  onShowEarlier: () => void
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  /** Receives the scroll container (find, turn navigator, selection menu). */
  scrollRef?: (el: HTMLDivElement | null) => void
  /** Session switch key — remounts list for clean enter animation. */
  sessionKey?: string
  projectId?: string | null
  sessionId?: string | null
}

/**
 * Live streaming view: render markdown progressively, line by line.
 * Complete lines (up to the last newline) go through MarkdownRenderer so the
 * structure — headings, lists, code blocks — appears as it arrives. The
 * incomplete tail line stays as cheap raw text, which caps re-parse cost at
 * the line rate instead of one full AST pass per animation frame.
 */
const StreamingMarkdown = memo(function StreamingMarkdown({
  text
}: {
  text: string
}): React.JSX.Element {
  const nl = text.lastIndexOf('\n')
  const complete = nl >= 0 ? text.slice(0, nl + 1) : ''
  const tail = nl >= 0 ? text.slice(nl + 1) : text
  return (
    <div className="message-content streaming message-content-live">
      {complete ? <MarkdownRenderer content={complete} /> : null}
      <span className="streaming-tail">
        {tail}
        <span className="cursor-blink">▍</span>
      </span>
    </div>
  )
})

/**
 * Thinking/reasoning: a single compact line while live — keeps the bubble
 * small and progress feels instant (Reasonix-style). The full text stays
 * available on demand via the toggle after the turn completes.
 */
function ThinkingBlock({
  text,
  live
}: {
  text: string
  live?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const spinnerSuffix = useModsUiStore((s) => s.spinnerSuffix)
  useEffect(() => {
    if (!live) return
    setElapsed(0)
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [live])
  if (!text?.trim()) return null
  if (live) {
    return (
      <div className="message-thinking live one-line" aria-live="polite">
        <span className="message-thinking-spinner" aria-hidden="true" />
        <span className="message-thinking-label">
          {t('chat.thinkingLive')}
          {spinnerSuffix ? (
            <span className="message-thinking-mod-suffix" title={t('chat.mods.spinnerSuffixHint')}>
              {' · '}
              {spinnerSuffix}
            </span>
          ) : null}
        </span>
        <span className="message-thinking-elapsed">{elapsed}s</span>
      </div>
    )
  }
  return (
    <div className="message-thinking">
      <button
        type="button"
        className="message-thinking-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>{t('chat.thinking')}</span>
      </button>
      {open && <pre className="message-thinking-body">{text}</pre>}
    </div>
  )
}

/** Hover-revealed send time (full timestamp in the tooltip). */
function MessageTime({ createdAt }: { createdAt: number }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const locale = i18n?.language || 'en'
  const label = formatMessageTime(createdAt, locale, (time) => t('chat.time.yesterday', { time }))
  if (!label) return null
  const ms = normalizeTimestampMs(createdAt)
  return (
    <time
      className="message-time"
      dateTime={ms ? new Date(ms).toISOString() : undefined}
      title={formatMessageTimeFull(createdAt, locale) || undefined}
    >
      {label}
    </time>
  )
}

/** "Worked for 1m 5s" — how long the agent spent on the turn ending here. */
export function WorkedFor({ durationMs }: { durationMs?: number }): React.JSX.Element | null {
  const { t } = useTranslation()
  const text = formatDuration(durationMs, {
    d: (n) => t('chat.duration.d', { n }),
    h: (n) => t('chat.duration.h', { n }),
    m: (n) => t('chat.duration.m', { n }),
    s: (n) => t('chat.duration.s', { n })
  })
  if (!text) return null
  return (
    <span className="message-worked">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
      </svg>
      {t('chat.duration.worked', { duration: text })}
    </span>
  )
}

const MessageRow = memo(function MessageRow({
  msg,
  animateIn,
  isStreamingTail,
  projectId,
  sessionId,
  canAct,
  continuation,
  intermediate,
  turnPrompt
}: {
  msg: Message
  animateIn?: boolean
  isStreamingTail?: boolean
  projectId?: string | null
  sessionId?: string | null
  canAct?: boolean
  /** Not the first assistant block of its turn: no role label. */
  continuation?: boolean
  /** A later assistant block follows in the same turn: no action row. */
  intermediate?: boolean
  /** The user prompt that started this turn (for "Repeat this"). */
  turnPrompt?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const live = useStreamingStore((s) => s.content[msg.id])
  const liveThinking = useStreamingStore((s) => s.thinking[msg.id])
  const liveActivity = useStreamingStore((s) => s.activity[msg.id])
  const content = live ?? msg.content
  const thinking = liveThinking ?? msg.thinking
  const isLive = live !== undefined
  // A SKILL.md draft (Record & Replay / agent revision) renders as a card.
  const skillSplit = useMemo(
    () => (msg.role === 'assistant' && !isLive && content.includes('skill') ? splitSkillAnswer(content) : null),
    [msg.role, isLive, content]
  )
  const copyText = msg.role === 'user' ? stripDisplayImages(msg.content) : msg.content
  const enterClass = animateIn ? ' message-enter' : ''
  const editAndResend = useChatStore((s) => s.editAndResend)
  const regenerate = useChatStore((s) => s.regenerate)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard optional */
    }
  }

  if (msg.role === 'system') {
    return (
      <div className={`message system${enterClass}`} data-message-id={msg.id}>
        <ToolMessage content={content} meta={msg.toolMeta} />
      </div>
    )
  }

  return (
    <div
      className={`message ${msg.role}${enterClass}${isStreamingTail || isLive ? ' message-live' : ''}${continuation ? ' message-continuation' : ''}${intermediate ? ' message-intermediate' : ''}`}
      data-message-id={msg.id}
    >
      {!continuation && (
        <div className="message-role">
          {msg.role === 'user' ? t('chat.you') : msg.id.startsWith('mod-') ? (
            <>
              {t('chat.mods.replyRole')}
              {msg.modelLabel ? <span className="message-mod-badge">{msg.modelLabel}</span> : null}
            </>
          ) : (
            t('chat.assistant')
          )}
        </div>
      )}
      <div className="message-body">
        {msg.role === 'assistant' && thinking ? (
          <ThinkingBlock text={thinking} live={Boolean(liveThinking)} />
        ) : null}
        {msg.role === 'assistant' && liveActivity ? (
          <div className="message-activity live one-line">
            <span className="message-thinking-spinner" aria-hidden="true" />
            <span className="message-activity-text">{liveActivity}</span>
          </div>
        ) : null}
        {editing && msg.role === 'user' ? (
          <div className="message-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="message-edit-actions">
              <button type="button" className="message-action-btn" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="message-action-btn primary"
                disabled={!draft.trim() || !projectId || !sessionId}
                onClick={() => {
                  if (!projectId || !sessionId) return
                  setEditing(false)
                  void editAndResend(projectId, sessionId, msg.id, draft)
                }}
              >
                {t('chat.saveAndResend')}
              </button>
            </div>
          </div>
        ) : msg.error ? (
          <ErrorCard
            error={msg.error}
            onRetry={
              projectId && sessionId
                ? () => void regenerate(projectId, sessionId, msg.id)
                : undefined
            }
          />
        ) : isLive && msg.role === 'assistant' ? (
          <StreamingMarkdown text={content} />
        ) : (
          <div className={`message-content${isStreamingTail ? ' streaming' : ''}`}>
            {skillSplit ? (
              <>
                {skillSplit.before && <MarkdownRenderer content={skillSplit.before} />}
                <SkillDraftCard draft={skillSplit.draft} projectId={projectId} />
                {skillSplit.after && <MarkdownRenderer content={skillSplit.after} />}
              </>
            ) : (
              <MarkdownRenderer content={content} />
            )}
          </div>
        )}
        {!intermediate && (
        <div className="message-actions">
          <button
            className={`message-copy ${copied ? 'copied' : ''}`}
            onClick={() => void handleCopy()}
            title={t('chat.copy')}
            aria-label={t('chat.copy')}
          >
            {copied ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? t('chat.copied') : t('chat.copy')}
          </button>
          {canAct && msg.role === 'user' && !isLive && (
            <button
              type="button"
              className="message-action-btn"
              onClick={() => {
                setDraft(stripDisplayImages(msg.content))
                setEditing(true)
              }}
            >
              {t('chat.edit')}
            </button>
          )}
          {canAct && msg.role === 'assistant' && !isLive && projectId && sessionId && (
            <button
              type="button"
              className="message-action-btn"
              onClick={() => void regenerate(projectId, sessionId, msg.id)}
            >
              {t('chat.regenerate')}
            </button>
          )}
          {canAct && msg.role === 'assistant' && !isLive && turnPrompt && (
            <button
              type="button"
              className="message-action-btn"
              title={t('chat.repeatHint')}
              onClick={() => openAutomationDraft({ prompt: turnPrompt, projectId: projectId || undefined })}
            >
              {t('chat.repeat')}
            </button>
          )}
          {!isLive && <MessageTime createdAt={msg.createdAt} />}
        </div>
        )}
      </div>
      {msg.role === 'assistant' && !isLive && (msg.modelLabel || msg.durationMs) ? (
        <div className="message-meta">
          <WorkedFor durationMs={msg.durationMs} />
          {msg.modelLabel && <span className="message-model-label">{msg.modelLabel}</span>}
        </div>
      ) : null}
    </div>
  )
})

export default function MessageList({
  messages,
  isStreaming,
  endRef,
  startIndex,
  nearTop,
  onShowEarlier,
  onScroll,
  scrollRef,
  sessionKey,
  projectId,
  sessionId
}: MessageListProps): React.JSX.Element {
  const { t } = useTranslation()
  const sessionBusy = useChatStore((s) =>
    sessionId ? s.streamingSessionIds.includes(sessionId) : s.isStreaming
  )
  const busy = isStreaming || sessionBusy
  const visible = startIndex > 0 ? messages.slice(startIndex) : messages
  const now = Date.now()
  const isFresh = (msg: Message): boolean =>
    typeof msg.createdAt === 'number' && now - msg.createdAt < 900
  const lastId = messages[messages.length - 1]?.id
  const lastRole = messages[messages.length - 1]?.role
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
  const turnHasAssistant = messages.slice(lastUserIdx + 1).some((m) => m.role === 'assistant')

  type RenderItem =
    | { kind: 'message'; msg: Message }
    | { kind: 'tool-batch'; id: string; messages: Message[] }

  // One turn reads as one answer: consecutive assistant blocks between two
  // user messages share a single "Assistant" label, and only the last one
  // carries Copy / Regenerate / time.
  const turnShape = new Map<string, { continuation: boolean; intermediate: boolean; prompt?: string }>()
  {
    let seenAssistant = false
    let lastAssistantId: string | null = null
    let prompt: string | undefined
    const flush = (): void => {
      if (lastAssistantId) {
        const cur = turnShape.get(lastAssistantId)
        if (cur) cur.intermediate = false
      }
    }
    for (const m of messages) {
      if (m.role === 'user') {
        flush()
        seenAssistant = false
        lastAssistantId = null
        prompt = stripDisplayImages(m.content).trim() || undefined
      } else if (m.role === 'assistant') {
        turnShape.set(m.id, { continuation: seenAssistant, intermediate: true, prompt })
        seenAssistant = true
        lastAssistantId = m.id
      }
    }
    flush()
  }

  const renderItems: RenderItem[] = []
  for (const msg of visible) {
    if (msg.role === 'system') {
      const last = renderItems[renderItems.length - 1]
      if (last && last.kind === 'tool-batch') {
        last.messages.push(msg)
      } else {
        renderItems.push({ kind: 'tool-batch', id: `batch-${msg.id}`, messages: [msg] })
      }
    } else {
      renderItems.push({ kind: 'message', msg })
    }
  }

  return (
    <div className="chat-messages" ref={scrollRef} onScroll={onScroll} data-session={sessionKey || ''}>
      {startIndex > 0 && nearTop && (
        <button className="message-load-earlier" onClick={onShowEarlier}>
          {t('chat.showEarlier', { count: startIndex })}
        </button>
      )}
      {renderItems.map((item) => (
        <MessageErrorBoundary key={item.kind === 'message' ? item.msg.id : item.id}>
          {item.kind === 'message' ? (
            <MessageRow
              msg={item.msg}
              animateIn={isFresh(item.msg)}
              isStreamingTail={busy && item.msg.id === lastId && item.msg.role === 'assistant'}
              projectId={projectId}
              sessionId={sessionId}
              canAct={!busy && Boolean(projectId && sessionId)}
              continuation={turnShape.get(item.msg.id)?.continuation}
              intermediate={turnShape.get(item.msg.id)?.intermediate}
              turnPrompt={turnShape.get(item.msg.id)?.prompt}
            />
          ) : (
            <ToolBatch
              messages={item.messages}
              animateIn={item.messages.some((m) => isFresh(m))}
            />
          )}
        </MessageErrorBoundary>
      ))}
      {busy && lastRole !== 'assistant' && (
        <div className={`message assistant message-enter${turnHasAssistant ? ' message-continuation' : ''}`}>
          {!turnHasAssistant && <div className="message-role">{t('chat.assistant')}</div>}
          <div className="message-content streaming">
            <span className="cursor-blink">▍</span>
          </div>
        </div>
      )}
      <SubagentActivity sessionId={sessionId} />
      {sessionId ? <LiveToolActivity sessionId={sessionId} /> : null}
      <div ref={endRef} />
    </div>
  )
}
