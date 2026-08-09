import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface MemoryItem {
  id: string
  kind: string
  title: string
  content: string
  scope: string
  pinned: boolean
  tags: string[]
  source?: string
}

export default function MemorySettingsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(true)
  const [autoCapture, setAutoCapture] = useState(true)
  const [injectOnTurn, setInjectOnTurn] = useState(true)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!window.api.memory) return
    try {
      const [s, st, list] = await Promise.all([
        window.api.memory.settings(),
        window.api.memory.stats(),
        window.api.memory.list({
          limit: 80,
          query: filter || undefined
        })
      ])
      setEnabled(s?.enabled !== false)
      setAutoCapture(s?.autoCapture !== false)
      setInjectOnTurn(s?.injectOnTurn !== false)
      setTotal(st?.total ?? 0)
      setItems((list?.items as MemoryItem[]) || [])
    } catch (e) {
      setMsg(String(e))
    }
  }, [filter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setMasterEnabled = async (on: boolean) => {
    if (!window.api.memory?.setSettings) return
    setBusy(true)
    try {
      // When enabling: keep current capture/inject prefs (default on).
      const next = await window.api.memory.setSettings(
        on
          ? { enabled: true, autoCapture, injectOnTurn }
          : { enabled: false }
      )
      setEnabled(next?.enabled !== false)
      setMsg(t('settings.memorySection.saved'))
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  const patchMemorySetting = async (patch: {
    autoCapture?: boolean
    injectOnTurn?: boolean
  }): Promise<void> => {
    if (!window.api.memory?.setSettings) return
    setBusy(true)
    try {
      const next = await window.api.memory.setSettings({ enabled, ...patch })
      setEnabled(next?.enabled !== false)
      setAutoCapture(next?.autoCapture !== false)
      setInjectOnTurn(next?.injectOnTurn !== false)
      setMsg(t('settings.memorySection.saved'))
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  const forget = async (id: string) => {
    if (!window.api.memory?.forget) return
    await window.api.memory.forget(id)
    void refresh()
  }

  const togglePin = async (m: MemoryItem) => {
    if (!window.api.memory?.update) return
    await window.api.memory.update(m.id, { pinned: !m.pinned })
    void refresh()
  }

  const clearAll = async () => {
    if (!window.api.memory?.clear) return
    if (!window.confirm(t('settings.memorySection.clearConfirm'))) return
    setBusy(true)
    try {
      await window.api.memory.clear({})
      void refresh()
      setMsg(t('settings.memorySection.cleared'))
    } finally {
      setBusy(false)
    }
  }

  const exportJson = async () => {
    if (!window.api.memory?.export) return
    const data = await window.api.memory.export()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pawn-memory-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async () => {
    if (!window.api.memory?.import) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const itemsArr = Array.isArray(parsed) ? parsed : parsed.items || []
        const res = await window.api.memory!.import(itemsArr)
        setMsg(t('settings.memorySection.imported', { n: res.imported ?? 0 }))
        void refresh()
      } catch (e) {
        setMsg(String(e))
      }
    }
    input.click()
  }

  if (!window.api.memory) {
    return <div className="settings-empty">{t('settings.memorySection.desktopOnly')}</div>
  }

  return (
    <div className="memory-settings">
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.memorySection.enabled')}</span>
            <span className="settings-row-desc">{t('settings.memorySection.enabledDesc')}</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => void setMasterEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        {enabled && (
          <>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{t('settings.memorySection.autoCapture')}</span>
                <span className="settings-row-desc">{t('settings.memorySection.autoCaptureDesc')}</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoCapture}
                  disabled={busy}
                  onChange={(e) => {
                    setAutoCapture(e.target.checked)
                    void patchMemorySetting({ autoCapture: e.target.checked })
                  }}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{t('settings.memorySection.injectOnTurn')}</span>
                <span className="settings-row-desc">{t('settings.memorySection.injectOnTurnDesc')}</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={injectOnTurn}
                  disabled={busy}
                  onChange={(e) => {
                    setInjectOnTurn(e.target.checked)
                    void patchMemorySetting({ injectOnTurn: e.target.checked })
                  }}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </>
        )}
        <div className="memory-stats">{t('settings.memorySection.stats', { total })}</div>
        <div className="memory-actions">
          <button type="button" className="test-btn" onClick={() => void exportJson()}>
            {t('settings.memorySection.export')}
          </button>
          <button type="button" className="test-btn" onClick={() => void importJson()}>
            {t('settings.memorySection.import')}
          </button>
          <button type="button" className="test-btn" onClick={() => void clearAll()} disabled={busy || total === 0}>
            {t('settings.memorySection.clearAll')}
          </button>
        </div>
        {msg && <div className="memory-msg">{msg}</div>}
      </div>

      <div className="settings-card memory-browser">
        <div className="memory-browser-head">
          <span className="settings-row-label">{t('settings.memorySection.browser')}</span>
          <input
            className="memory-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refresh()
            }}
            placeholder={t('settings.memorySection.filterPlaceholder')}
          />
          <button type="button" className="test-btn" onClick={() => void refresh()}>
            {t('settings.memorySection.refresh')}
          </button>
        </div>
        {items.length === 0 ? (
          <div className="settings-empty">{t('settings.memorySection.empty')}</div>
        ) : (
          <ul className="memory-list">
            {items.map((m) => (
              <li key={m.id} className="memory-item">
                <div className="memory-item-main">
                  <div className="memory-item-title">
                    <span className="settings-badge">{m.kind}</span>
                    {m.pinned && <span className="settings-badge memory-badge-pin">pin</span>}
                    <strong>{m.title}</strong>
                  </div>
                  <div className="memory-item-body">{m.content}</div>
                  <div className="memory-item-meta">
                    {m.scope}
                    {m.source ? ` · ${m.source}` : ''}
                    {m.tags?.length ? ` · ${m.tags.join(', ')}` : ''}
                  </div>
                </div>
                <div className="memory-item-actions">
                  <button
                    type="button"
                    className="memory-icon-btn"
                    title={t('settings.memorySection.pin')}
                    onClick={() => void togglePin(m)}
                  >
                    {m.pinned ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    className="delete-btn"
                    title={t('settings.memorySection.forget')}
                    onClick={() => void forget(m.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
