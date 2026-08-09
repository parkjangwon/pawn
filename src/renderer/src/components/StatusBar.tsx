import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useChatStore } from '../stores/chat'
import { useAppStore } from '../stores/app'
import { useUsageStore, formatTokens } from '../stores/usage'
import { useSubagentRunsStore } from '../stores/subagentRuns'
import './StatusBar.css'

export default function StatusBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { providers, models, routingMode, activeModelId } = useProviderStore()
  const { isStreaming, streamingSessionId, streamingSessionIds } = useChatStore()
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessionId = streamingSessionId || activeSessionId || ''
  const concurrentTurns = streamingSessionIds.length
  const totals = useUsageStore((s) => (sessionId ? s.totalsFor(sessionId) : null))
  const activeSubs = useSubagentRunsStore((s) =>
    sessionId ? s.activeForSession(sessionId) : []
  )
  const recentSubs = useSubagentRunsStore((s) =>
    sessionId ? s.recentForSession(sessionId, 3) : []
  )

  const enabledProviders = providers.filter((p) => p.enabled)
  const activeModel = models.find((m) => m.id === activeModelId)
  const firstEnabledModel = models.find((m) => m.enabled)
  const currentModel = activeModel || firstEnabledModel

  const subLabel =
    activeSubs.length > 0
      ? `${activeSubs.length} subagent${activeSubs.length > 1 ? 's' : ''}`
      : recentSubs.some((r) => r.status === 'error')
        ? 'subagent err'
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
            title={`cache hit ${(totals.cacheHitRate * 100).toFixed(0)}% · saved $${totals.savedCost.toFixed(4)}`}
          >
            {formatTokens(totals.inputTokens + totals.cacheReadTokens)}in · $
            {totals.cost.toFixed(3)}
            {totals.cacheHitRate > 0
              ? ` · ${(totals.cacheHitRate * 100).toFixed(0)}% cache`
              : ''}
          </span>
        )}
        {routingMode !== 'auto' && currentModel && (
          <span className="status-model">{currentModel.label || currentModel.modelId}</span>
        )}
        <span className="status-mode">
          {routingMode === 'auto' ? t('statusBar.auto') : t('statusBar.manual')}
        </span>
      </div>
    </div>
  )
}
