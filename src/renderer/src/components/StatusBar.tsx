import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useChatStore } from '../stores/chat'
import './StatusBar.css'

export default function StatusBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { providers, models, routingMode, activeModelId } = useProviderStore()
  const { isStreaming } = useChatStore()

  const enabledProviders = providers.filter((p) => p.enabled)
  const activeModel = models.find((m) => m.id === activeModelId)
  const firstEnabledModel = models.find((m) => m.enabled)
  const currentModel = activeModel || firstEnabledModel

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className={`status-dot ${isStreaming ? 'streaming' : enabledProviders.length > 0 ? 'connected' : 'disconnected'}`} />
        <span className="status-text">
          {isStreaming ? '{t("statusBar.working")}' : enabledProviders.length > 0 ? '{t("statusBar.ready")}' : '{t("statusBar.noProvider")}'}
        </span>
      </div>
      <div className="status-right">
        {currentModel && (
          <span className="status-model">{currentModel.label || currentModel.modelId}</span>
        )}
        <span className="status-mode">{routingMode === 'auto' ? '{t("statusBar.auto")}' : '{t("statusBar.manual")}'}</span>
      </div>
    </div>
  )
}
