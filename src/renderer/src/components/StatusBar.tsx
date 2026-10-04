import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useProviderStore } from '../stores/provider'
import { useChatStore } from '../stores/chat'
import { useAppStore } from '../stores/app'
import { useUsageStore, formatTokens } from '../stores/usage'
import { useSubagentRunsStore } from '../stores/subagentRuns'
import './StatusBar.css'

export default function StatusBar(): React.JSX.Element {
  const { t } = useTranslation()
  const providers = useProviderStore((s) => s.providers)
  const models = useProviderStore((s) => s.models)
  const routingMode = useProviderStore((s) => s.routingMode)
  const activeModelId = useProviderStore((s) => s.activeModelId)

  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingSessionId = useChatStore((s) => s.streamingSessionId)
  const concurrentTurns = useChatStore((s) => s.streamingSessionIds.length)

  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessionId = streamingSessionId || activeSessionId || ''
  const totals = useUsageStore((s) => (sessionId ? s.totalsFor(sessionId) : null))

  const activeSubs = useSubagentRunsStore(
    useShallow((s) =>
      sessionId ? s.runs.filter((r) => r.parentSessionId === sessionId && r.status === 'running') : []
    )
  )
  const hasSubError = useSubagentRunsStore((s) =>
    sessionId ? s.runs.slice(-5).some((r) => r.parentSessionId === sessionId && r.status === 'error') : false
  )
  // In Auto routing the concrete model still matters (cost, capability) —
  // surface the router's last decision instead of hiding it.
  const lastRoute = useUsageStore((s) => (sessionId ? s.lastRoute[sessionId] : undefined))
  const lastRouteLabel = lastRoute?.label
  const lastRouteReason = lastRoute?.reason

  const enabledProviders = providers.filter((p) => p.enabled)
  const activeModel = models.find((m) => m.id === activeModelId)
  const firstEnabledModel = models.find((m) => m.enabled)
  const currentModel = activeModel || firstEnabledModel

  const subLabel =
    activeSubs.length > 0
      ? t('statusBar.subagentsRunning', { count: activeSubs.length })
      : hasSubError
        ? t('statusBar.subagentError')
        : null

  return (
    <div className="status-bar">
      <div className="status-left">
        <span
          className={`status-dot ${
            isStreaming
              ? 'streaming'
              : enabledProviders.length > 0
                ? 'connected'
                : 'disconnected'
          }`}
        />
        <span className="status-text">
          {isStreaming
            ? concurrentTurns > 1
              ? t('statusBar.workingMulti', { count: concurrentTurns })
              : t('statusBar.working')
            : enabledProviders.length > 0
              ? t('statusBar.ready')
              : t('statusBar.noProvider')}
        </span>
        {subLabel && (
          <button
            type="button"
            className="status-subagents"
            title={
              activeSubs.map((r) => `${r.name} [${r.agent}]`).join(', ') ||
              t('statusBar.openAgents')
            }
            onClick={() => {
              try {
                window.__openRightPanelTab?.('agents')
              } catch {
                /* optional */
              }
            }}
          >
            {subLabel}
            {activeSubs.length > 0 &&
              ` · r${Math.max(...activeSubs.map((r) => r.rounds), 0)}`}
          </button>
        )}
      </div>
      <div className="status-right">
        {totals && totals.calls > 0 && (
          <span
            className="status-usage"
            title={t('statusBar.usageHint', { rate: (totals.cacheHitRate * 100).toFixed(0), saved: totals.savedCost.toFixed(4) })}
          >
            {t('statusBar.usageTokens', { tokens: formatTokens(totals.inputTokens + totals.cacheReadTokens) })} · ${totals.cost.toFixed(3)}
            {totals.cacheHitRate > 0
              ? ` · ${t('statusBar.usageCache', { rate: (totals.cacheHitRate * 100).toFixed(0) })}`
              : ''}
          </span>
        )}
        {routingMode === 'auto' ? (
          lastRouteLabel ? (
            <span className="status-model" title={lastRouteReason}>{lastRouteLabel}</span>
          ) : null
        ) : (
          currentModel && (
            <span className="status-model">{currentModel.label || currentModel.modelId}</span>
          )
        )}
        <span className="status-mode">
          {routingMode === 'auto' ? t('statusBar.auto') : t('statusBar.manual')}
        </span>
      </div>
    </div>
  )
}
