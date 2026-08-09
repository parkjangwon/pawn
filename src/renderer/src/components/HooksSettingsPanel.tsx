import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'

interface HooksSettings {
  enabled: boolean
  readClaude: boolean
  readPawn: boolean
}

interface HookRow {
  id: string
  event: string
  matcher: string
  type: string
  commandOrUrl: string
  source: string
}

const defaultSettings: HooksSettings = {
  enabled: true,
  readClaude: true,
  readPawn: true
}

export default function HooksSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const projectPath = useAppStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return getEffectiveProjectPath(p, useAppStore.getState().activeSessionId) || null
  })
  const [settings, setSettings] = useState<HooksSettings>(defaultSettings)
  const [hooks, setHooks] = useState<HookRow[]>([])
  const [bySource, setBySource] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!window.api.hooks) return
    try {
      const list = await window.api.hooks.list(projectPath)
      setSettings({ ...defaultSettings, ...(list?.settings || {}) })
      setHooks(list?.hooks || [])
      setBySource(list?.bySource || {})
    } catch (e) {
      setMsg(String(e))
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patch = async (partial: Partial<HooksSettings>) => {
    if (!window.api.hooks?.setSettings) return
    setBusy(true)
    try {
      const next = await window.api.hooks.setSettings(partial)
      setSettings({ ...defaultSettings, ...(next || {}) })
      setMsg(t('settings.hooksSection.saved'))
      void refresh()
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!window.api.hooks) {
    return <div className="settings-empty">{t('settings.hooksSection.desktopOnly')}</div>
  }

  return (
    <div className="hooks-settings">
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.hooksSection.enabled')}</span>
            <span className="settings-row-desc">{t('settings.hooksSection.enabledDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(e) => void patch({ enabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.hooksSection.readClaude')}</span>
            <span className="settings-row-desc">{t('settings.hooksSection.readClaudeDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.readClaude}
              disabled={busy || !settings.enabled}
              onChange={(e) => void patch({ readClaude: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.hooksSection.readPawn')}</span>
            <span className="settings-row-desc">{t('settings.hooksSection.readPawnDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.readPawn}
              disabled={busy || !settings.enabled}
              onChange={(e) => void patch({ readPawn: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="memory-stats">
          {t('settings.hooksSection.stats', {
            total: hooks.length,
            sources: Object.entries(bySource)
              .map(([k, n]) => `${k}:${n}`)
              .join(' · ') || '—'
          })}
        </div>
        <div className="memory-actions">
          <button type="button" className="test-btn" onClick={() => void refresh()} disabled={busy}>
            {t('settings.hooksSection.refresh')}
          </button>
        </div>
        {msg && <div className="memory-msg">{msg}</div>}
      </div>

      <div className="settings-card memory-browser">
        <div className="memory-browser-head">
          <span className="settings-row-label">{t('settings.hooksSection.loaded')}</span>
        </div>
        {hooks.length === 0 ? (
          <div className="settings-empty">{t('settings.hooksSection.empty')}</div>
        ) : (
          <ul className="memory-list">
            {hooks.map((h) => (
              <li key={h.id} className="memory-item">
                <div className="memory-item-main">
                  <div className="memory-item-title">
                    <span className="settings-badge">{h.event}</span>
                    <span className="settings-badge">{h.source}</span>
                    {h.matcher && h.matcher !== '*' && (
                      <span className="settings-badge">{h.matcher}</span>
                    )}
                  </div>
                  <div className="memory-item-body">
                    <code className="hooks-cmd">{h.commandOrUrl}</code>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
