import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCost, formatTokens } from '../stores/usage'
import './UsageSettingsPanel.css'

type RangeKey = '1d' | '7d' | '30d' | 'all'

interface SummaryRow {
  modelId: string
  providerId: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}

function sinceFor(range: RangeKey): number {
  const now = Math.floor(Date.now() / 1000)
  if (range === '1d') return now - 86400
  if (range === '7d') return now - 7 * 86400
  if (range === '30d') return now - 30 * 86400
  return 0
}

export default function UsageSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeKey>('7d')
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const api = window.api?.db?.getUsageSummary
      if (!api) {
        setRows([])
        setError(t('settings.usageSection.desktopOnly'))
        return
      }
      const data = await api(sinceFor(range))
      setRows(Array.isArray(data) ? (data as SummaryRow[]) : [])
    } catch (e) {
      setError(String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [range, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const totals = useMemo(() => {
    let cost = 0
    let calls = 0
    let input = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0
    for (const r of rows) {
      cost += Number(r.cost) || 0
      calls += Number(r.calls) || 0
      input += Number(r.inputTokens) || 0
      output += Number(r.outputTokens) || 0
      cacheRead += Number(r.cacheReadTokens) || 0
      cacheWrite += Number(r.cacheWriteTokens) || 0
    }
    const prompt = input + cacheRead + cacheWrite
    const hit = prompt > 0 ? cacheRead / prompt : 0
    return { cost, calls, input, output, cacheRead, hit }
  }, [rows])

  return (
    <div className="usage-settings">
      <p className="settings-desc">{t('settings.usageSection.desc')}</p>

      <div className="usage-toolbar">
        <div className="theme-toggle usage-range" role="group">
          {(
            [
              ['1d', 'settings.usageSection.range1d'],
              ['7d', 'settings.usageSection.range7d'],
              ['30d', 'settings.usageSection.range30d'],
              ['all', 'settings.usageSection.rangeAll']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={range === key ? 'active' : ''}
              onClick={() => setRange(key)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <button type="button" className="test-btn" onClick={() => void refresh()}>
          {t('settings.usageSection.refresh')}
        </button>
      </div>

      <div className="usage-summary-cards">
        <div className="usage-stat">
          <span className="usage-stat-val">{formatCost(totals.cost)}</span>
          <span className="usage-stat-label">{t('settings.usageSection.totalCost')}</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-val">{totals.calls}</span>
          <span className="usage-stat-label">{t('settings.usageSection.totalCalls')}</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-val">{formatTokens(totals.input + totals.output)}</span>
          <span className="usage-stat-label">{t('settings.usageSection.totalTokens')}</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-val">{Math.round(totals.hit * 100)}%</span>
          <span className="usage-stat-label">{t('settings.usageSection.cacheHit')}</span>
        </div>
      </div>

      {loading && <div className="settings-empty">{t('common.loading')}</div>}
      {error && <div className="settings-row-desc mcp-form-error">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="settings-empty">{t('settings.usageSection.empty')}</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="usage-table-wrap">
          <table className="usage-table">
            <thead>
              <tr>
                <th>{t('settings.usageSection.colModel')}</th>
                <th>{t('settings.usageSection.colProvider')}</th>
                <th>{t('settings.usageSection.colCalls')}</th>
                <th>{t('settings.usageSection.colTokens')}</th>
                <th>{t('settings.usageSection.colCost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.providerId}:${r.modelId}`}>
                  <td className="usage-mono">{r.modelId}</td>
                  <td className="usage-mono">{r.providerId}</td>
                  <td>{r.calls}</td>
                  <td>
                    {formatTokens(
                      (Number(r.inputTokens) || 0) +
                        (Number(r.outputTokens) || 0) +
                        (Number(r.cacheReadTokens) || 0)
                    )}
                  </td>
                  <td>{formatCost(Number(r.cost) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
