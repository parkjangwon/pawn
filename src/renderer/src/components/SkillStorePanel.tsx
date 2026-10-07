import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clearProjectContextCache } from '../agent/skills'
import { dedupeByName, formatInstalls, PAGE_SIZE, pageCount, pageSlice, sortSkills, type SkillSort, type StoreSkill } from '../utils/skillStore'
import type { SettingsState } from './settingsState'
import Button from './Button'
import Input from './Input'
import { tx } from '../i18n'

/**
 * Settings → Skill store: search public skills (skills.sh), read what each
 * does, install into ~/.agents/skills (shared with Claude Code / Codex / …)
 * or remove again. Search · paging · sort (popular / newest / name).
 */
export default function SkillStorePanel({ state }: { state: SettingsState }): React.JSX.Element {
  const api = window.api?.skills
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StoreSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SkillSort>('popular')
  const [page, setPage] = useState(1)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Record<string, 'install' | 'remove'>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [datesLoading, setDatesLoading] = useState(false)
  const details = useRef(new Map<string, { description: string; firstSeen?: string }>())
  const [, bump] = useState(0)
  const searchSeq = useRef(0)

  const refreshInstalled = useCallback(async () => {
    const names = await api?.installed().catch(() => [] as string[])
    setInstalled(new Set((names || []).map((n) => n.toLowerCase())))
  }, [api])

  // Debounced search; empty query → most installed (leaderboard).
  useEffect(() => {
    if (!api) return
    const seq = ++searchSeq.current
    const q = query.trim()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      const r = await api.search(q.length >= 2 ? q : '').catch((e: unknown) => { console.warn('[skill-store]', e); return { skills: [] as RegistrySkill[], error: 'Something failed — see the console for details.' } })
      if (seq !== searchSeq.current) return
      setResults(dedupeByName(r.skills))
      setError(r.error || null)
      setPage(1)
      setLoading(false)
    }, q ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [api, query])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  const loadDetails = useCallback(
    async (ids: string[]) => {
      if (!api) return
      const todo = ids.filter((id) => !details.current.has(id))
      let i = 0
      const worker = async (): Promise<void> => {
        while (i < todo.length) {
          const id = todo[i++]
          const d = await api.details(id).catch(() => null)
          if (d && !('error' in d)) details.current.set(id, d)
          else details.current.set(id, { description: '' })
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker))
      if (todo.length) bump((n) => n + 1)
    },
    [api]
  )

  const withDetails = useMemo(
    () => results.map((s) => ({ ...s, ...(details.current.get(s.id) || {}) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, details.current.size]
  )
  const sorted = useMemo(() => sortSkills(withDetails, sort), [withDetails, sort])
  const pages = pageCount(sorted.length)
  const visible = pageSlice(sorted, page)

  // Descriptions for what's on screen; every date when sorting by newest.
  useEffect(() => {
    void loadDetails(visible.map((s) => s.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((s) => s.id).join('|')])
  useEffect(() => {
    if (sort !== 'newest' || results.length === 0) return
    setDatesLoading(true)
    void loadDetails(results.slice(0, 120).map((s) => s.id)).finally(() => setDatesLoading(false))
  }, [sort, results, loadDetails])

  const install = async (s: StoreSkill): Promise<void> => {
    if (!api) return
    setBusy((b) => ({ ...b, [s.id]: 'install' }))
    setNotice(null)
    const r = await api.install(s.id).catch((e: unknown) => { console.warn('[skill-store]', e); return { ok: false as const, error: 'Something failed — see the console for details.' } })
    setBusy((b) => {
      const { [s.id]: _, ...rest } = b
      return rest
    })
    if (r.ok) {
      clearProjectContextCache()
      setNotice(`Installed ${r.name} — available in new chats`)
    } else {
      setNotice(`Install failed: ${r.error}`)
    }
    await refreshInstalled()
  }

  const remove = async (s: StoreSkill): Promise<void> => {
    if (!api) return
    setBusy((b) => ({ ...b, [s.id]: 'remove' }))
    const r = await api.remove(s.name).catch((e: unknown) => { console.warn('[skill-store]', e); return { ok: false, error: 'Something failed — see the console for details.' } })
    setBusy((b) => {
      const { [s.id]: _, ...rest } = b
      return rest
    })
    if (r.ok) {
      clearProjectContextCache()
      setNotice(`Removed ${s.name}`)
    } else {
      setNotice(`Remove failed: ${r.error || ''}`)
    }
    await refreshInstalled()
  }

  if (!api) {
    return (
      <div className="settings-section">
        <h2>{'Skill store'}</h2>
        <div className="settings-empty">{'The skill store needs the desktop app.'}</div>
      </div>
    )
  }

  return (
    <div className="settings-section skill-store">
      <h2>{'Skill store'}</h2>
      <p className="settings-desc">{'Find public skills on skills.sh and install them in one click. Installed skills go to ~/.agents/skills, so Claude Code, Codex and other agents can use them too.'}</p>

      <div className="skill-store-toolbar">
        <Input
          className="plugin-search-input skill-store-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={'Search skills by name (e.g. pdf, excel, slides)'}
          aria-label={'Search skills by name (e.g. pdf, excel, slides)'}
        />
        <div className="plugin-scope-toggle" role="radiogroup" aria-label={'Sort'}>
          {(['popular', 'newest', 'name'] as SkillSort[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={sort === k}
              className={`plugin-scope-btn ${sort === k ? 'active' : ''}`}
              onClick={() => {
                setSort(k)
                setPage(1)
              }}
            >
              {tx(`settings.skillStore.sort.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="skill-store-status" aria-live="polite">
        {loading
          ? 'Searching…'
          : error
            ? `Could not reach skills.sh (${error})`
            : query.trim().length === 1
              ? 'Type at least 2 letters to search'
              : tx(query.trim() ? 'settings.skillStore.resultCount' : 'settings.skillStore.popularCount', { count: sorted.length })}
        {sort === 'newest' && datesLoading && !loading ? ` · ${'loading dates…'}` : ''}
        {notice ? <span className="skill-store-notice"> · {notice}</span> : null}
      </div>

      {!loading && sorted.length === 0 && !error && query.trim().length >= 2 && (
        <div className="settings-empty">{'No skills match. Try a different word.'}</div>
      )}

      <div className="skill-store-grid">
        {visible.map((s) => {
          const isInstalled = installed.has(s.name.toLowerCase())
          const state = busy[s.id]
          return (
            <article key={s.id} className="skill-store-card">
              <div className="skill-store-card-head">
                <h3 className="skill-store-name" title={s.id}>{s.name}</h3>
                {isInstalled && <span className="settings-badge skill-store-installed">{'Installed'}</span>}
              </div>
              <p className="skill-store-desc">
                {s.description === undefined ? <span className="skill-store-muted">{'Loading…'}</span> : s.description || <span className="skill-store-muted">{'No description'}</span>}
              </p>
              <div className="skill-store-meta">
                <a href={`https://skills.sh/${s.id}`} target="_blank" rel="noopener noreferrer" className="skill-store-source" title={'Open on skills.sh'}>
                  {s.source}
                </a>
                <span title={'Total installs'}>↓ {formatInstalls(s.installs)}</span>
                {s.firstSeen && <span title={'First seen on skills.sh'}>{s.firstSeen}</span>}
              </div>
              <div className="skill-store-actions">
                {isInstalled ? (
                  <button type="button" className="delete-btn skill-store-btn" disabled={!!state} onClick={() => void remove(s)}>
                    {state === 'remove' ? 'Removing…' : 'Remove'}
                  </button>
                ) : (
                  <Button type="button" className="skill-store-btn" disabled={!!state} onClick={() => void install(s)}>
                    {state === 'install' ? 'Installing…' : 'Install'}
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {pages > 1 && (
        <nav className="skill-store-pager" aria-label={'Pages'}>
          <button type="button" className="test-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {'Previous'}
          </button>
          <span>{`Page ${page} of ${pages}`}</span>
          <button type="button" className="test-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {'Next'}
          </button>
        </nav>
      )}
      <p className="settings-row-desc skill-store-foot">{`${PAGE_SIZE} per page. Skills are instructions the agent follows — only install ones you trust.`}</p>
    </div>
  )
}
