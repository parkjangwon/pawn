import { useCallback, useEffect, useMemo, useState } from 'react'
import { tx } from '../i18n'
import { useAppStore } from '../stores/app'
import ConfirmDialog from './ConfirmDialog'
import Input, { Textarea } from './Input'
import Switch from './Switch'
import WikiGraph from './WikiGraph'

interface WikiPageMeta {
  slug: string
  title: string
  summary: string
  tags: string[]
  created: string
  updated: string
  links: string[]
  backlinks: number
  chars: number
}

interface WikiPage extends WikiPageMeta {
  body: string
}

interface LogEntry {
  at: string
  op: string
  title: string
  detail: string
}

interface LintIssue {
  type: string
  slug: string
  detail: string
}

type Scope = 'user' | 'project'
type Tab = 'graph' | 'pages' | 'log'

function fmtDate(iso: string): string {
  return (iso || '').slice(0, 10)
}

export default function WikiPanel(): React.JSX.Element {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projectName = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name || '')
  const hasProject = !!activeProjectId && activeProjectId !== '__general__'

  const [enabled, setEnabled] = useState(true)
  const [injectIndex, setInjectIndex] = useState(true)
  const [scope, setScope] = useState<Scope>('user')
  const [tab, setTab] = useState<Tab>('graph')
  const [items, setItems] = useState<WikiPageMeta[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<{ pages: number; links: number; dir: string } | null>(null)
  const [filter, setFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [graph, setGraph] = useState<WikiGraphDto>({ nodes: [], edges: [] })
  const [log, setLog] = useState<LogEntry[]>([])
  const [lint, setLint] = useState<{ ok: boolean; issues: LintIssue[]; pages: number } | null>(null)
  const [selected, setSelected] = useState<WikiPage | null>(null)
  const [draft, setDraft] = useState<{ title: string; summary: string; tags: string; body: string }>({
    title: '',
    summary: '',
    tags: '',
    body: ''
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<(() => void) | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ slugs: string[]; titles: string[] } | null>(null)
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<'updated' | 'title' | 'links'>('updated')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const effectiveScope: Scope = scope === 'project' && hasProject ? 'project' : 'user'
  const projectId = effectiveScope === 'project' ? activeProjectId : null

  useEffect(() => {
    if (!hasProject && scope === 'project') setScope('user')
  }, [hasProject, scope])

  // Debounce the filter so typing does not fire an IPC query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setAppliedFilter(filter), 300)
    return () => clearTimeout(id)
  }, [filter])

  const refresh = useCallback(async () => {
    if (!window.api.wiki) return
    try {
      const [s, st, list] = await Promise.all([
        window.api.wiki.settings(),
        window.api.wiki.stats({ scope: effectiveScope, projectId }),
        window.api.wiki.list({ scope: effectiveScope, projectId, query: appliedFilter || undefined, limit: 200 })
      ])
      setEnabled(s.enabled !== false)
      setInjectIndex(s.injectIndex !== false)
      setStats(st)
      setItems(list.items)
      setTotal(list.total)
    } catch (e) {
      console.warn('[wiki]', e)
      setMsg('Something failed — see the console for details.')
    }
  }, [effectiveScope, projectId, appliedFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadGraph = useCallback(async () => {
    if (!window.api.wiki) return
    try {
      setGraph(await window.api.wiki.graph({ scope: effectiveScope, projectId }))
    } catch {
      /* non-fatal */
    }
  }, [effectiveScope, projectId])

  useEffect(() => {
    setSelected(null)
    setIsDirty(false)
    setLint(null)
    if (!window.api.wiki) return
    if (tab === 'graph') {
      void loadGraph()
    } else if (tab === 'log') {
      void window.api.wiki
        .log({ scope: effectiveScope, projectId, limit: 80 })
        .then(setLog)
        .catch(() => {})
    }
  }, [tab, effectiveScope, projectId, loadGraph])

  const openPage = async (slug: string): Promise<void> => {
    if (!window.api.wiki) return
    const res = await window.api.wiki.read({ ref: slug, scope: effectiveScope, projectId }).catch(() => null)
    if (res?.ok && res.page) {
      const page = res.page
      const apply = (): void => {
        setSelected({ ...page, body: page.body || '' })
        setDraft({
          title: page.title,
          summary: page.summary,
          tags: page.tags.join(', '),
          body: page.body || ''
        })
        setIsDirty(false)
        // A page opened from graph/lint must land where the editor lives.
        setTab('pages')
      }
      if (isDirty) setConfirmDiscard(() => apply)
      else apply()
    }
  }

  const closeEditor = (): void => {
    setSelected(null)
    setIsDirty(false)
  }

  const patchSettings = async (patch: { enabled?: boolean; injectIndex?: boolean }): Promise<void> => {
    if (!window.api.wiki?.setSettings) return
    setBusy(true)
    try {
      const next = await window.api.wiki.setSettings(patch)
      setEnabled(next.enabled !== false)
      setInjectIndex(next.injectIndex !== false)
      setMsg('Saved')
    } catch (e) {
      console.warn('[wiki]', e)
      setMsg('Something failed — see the console for details.')
    } finally {
      setBusy(false)
    }
  }

  const savePage = async (): Promise<void> => {
    if (!window.api.wiki?.write) return
    setBusy(true)
    try {
      const res = await window.api.wiki.write({
        title: draft.title,
        body: draft.body,
        summary: draft.summary,
        tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
        scope: effectiveScope,
        projectId
      })
      if (res.ok) {
        setMsg('Saved')
        setIsDirty(false)
        await refresh()
        if (tab === 'graph') await loadGraph()
        if (res.page) await openPage(res.page.slug)
      } else {
        setMsg(res.error || 'Something failed — see the console for details.')
      }
    } catch (e) {
      console.warn('[wiki]', e)
      setMsg('Something failed — see the console for details.')
    } finally {
      setBusy(false)
    }
  }

  const requestDelete = (slugs: string[]): void => {
    const titles = slugs.map(
      (s) => items.find((p) => p.slug === s)?.title || selected?.title || s
    )
    setConfirmDelete({ slugs, titles })
  }

  const runLint = async (fix: boolean): Promise<void> => {
    if (!window.api.wiki?.lint) return
    setBusy(true)
    try {
      setLint(await window.api.wiki.lint({ scope: effectiveScope, projectId, fix }))
    } catch (e) {
      console.warn('[wiki]', e)
      setMsg('Something failed — see the console for details.')
    } finally {
      setBusy(false)
    }
  }

  const runAutoLink = async (): Promise<void> => {
    if (!window.api.wiki?.autolink) return
    setBusy(true)
    try {
      const res = await window.api.wiki.autolink({ scope: effectiveScope, projectId })
      const n = (res.linksAdded || 0) + (res.seeAlsoAdded || 0)
      setMsg(n > 0 ? `Added ${n} links across the wiki` : 'No new links to add — pages already connected or no title mentions found')
      await refresh()
      await loadGraph()
    } catch (e) {
      console.warn('[wiki]', e)
      setMsg('Something failed — see the console for details.')
    } finally {
      setBusy(false)
    }
  }

  const newPage = (): void => {
    setSelected({ slug: '', title: '', summary: '', tags: [], created: '', updated: '', links: [], backlinks: 0, chars: 0, body: '' })
    setDraft({ title: '', summary: '', tags: '', body: '' })
    setTab('pages')
  }

  const issueTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of lint?.issues || []) counts.set(i.type, (counts.get(i.type) || 0) + 1)
    return Array.from(counts.entries())
  }, [lint])

  // Selection only covers pages that still exist (delete/filter/scope changes).
  useEffect(() => {
    setSelectedSlugs((prev) => {
      if (!prev.size) return prev
      const alive = new Set(items.map((p) => p.slug))
      const next = new Set([...prev].filter((s) => alive.has(s)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const sortedItems = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      if (sortKey === 'title') return dir * a.title.localeCompare(b.title)
      if (sortKey === 'links') return dir * (a.links.length + a.backlinks - (b.links.length + b.backlinks))
      return dir * (a.updated || '').localeCompare(b.updated || '')
    })
  }, [items, sortKey, sortDir])

  const allSelected = items.length > 0 && selectedSlugs.size === items.length
  const someSelected = selectedSlugs.size > 0 && selectedSlugs.size < items.length

  const toggleAll = (): void => {
    setSelectedSlugs(allSelected ? new Set() : new Set(items.map((p) => p.slug)))
  }

  const toggleOne = (slug: string): void => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const setSort = (key: 'updated' | 'title' | 'links'): void => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'title' ? 'asc' : 'desc')
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (!window.api.wiki?.delete || !confirmDelete) return
    setConfirmDelete(null)
    setBusy(true)
    try {
      for (const slug of confirmDelete.slugs) {
        await window.api.wiki.delete({ slug, scope: effectiveScope, projectId })
      }
      if (selected && confirmDelete.slugs.includes(selected.slug)) {
        setSelected(null)
        setIsDirty(false)
      }
      setSelectedSlugs(new Set())
      setMsg('')
      await refresh()
      if (tab === 'graph') await loadGraph()
    } catch (e) {
      console.warn('[wiki]', e)
      setMsg('Something failed — see the console for details.')
    } finally {
      setBusy(false)
    }
  }

  if (!window.api.wiki) {
    return <div className="settings-empty">{'The wiki is available in the desktop app.'}</div>
  }

  return (
    <>
      {confirmDiscard && (
        <ConfirmDialog
          title={'Discard changes?'}
          message={'You have unsaved edits on this page. Discard them?'}
          confirmLabel={'Discard'}
          danger
          onConfirm={() => {
            const action = confirmDiscard
            setConfirmDiscard(null)
            setIsDirty(false)
            action()
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={'Delete page?'}
          message={
            confirmDelete.slugs.length === 1
              ? `Delete “${confirmDelete.titles[0]}”? Links pointing here will break (the health check lists them).`
              : `Delete ${confirmDelete.slugs.length} pages? Links pointing at them will break (the health check lists them).`
          }
          confirmLabel={'Delete'}
          danger
          onConfirm={() => void deleteSelected()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      <div className="wiki-settings">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{'Use wiki'}</span>
              <span className="settings-row-desc">{'Let the agent read, write, and link wiki pages'}</span>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              aria-label={'Use wiki'}
              onCheckedChange={(v) => void patchSettings({ enabled: v })}
            />
          </div>
          {enabled && (
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{'Recall on every request'}</span>
                <span className="settings-row-desc">{'Add the wiki index and recent activity to the prompt so the agent starts from what it already knows'}</span>
              </div>
              <Switch
                checked={injectIndex}
                disabled={busy}
                aria-label={'Recall on every request'}
                onCheckedChange={(v) => void patchSettings({ injectIndex: v })}
              />
            </div>
          )}
          <div className="wiki-stats">
            {stats
              ? `${stats.pages} pages · ${stats.links} links`
              : ''}
            {stats?.dir ? ' · ' + stats.dir : ''}
          </div>
          <div className="wiki-actions">
            <button type="button" className="test-btn" onClick={() => void runAutoLink()} disabled={busy}>
              {'Auto-link pages'}
            </button>
            <button type="button" className="test-btn" onClick={() => void runLint(true)} disabled={busy}>
              {'Check wiki health'}
            </button>
            {stats?.dir && (
              <button
                type="button"
                className="test-btn"
                onClick={() => void window.api?.workspace?.openPath?.(stats.dir)}
              >
                {'Open folder'}
              </button>
            )}
          </div>
          {lint && (
            <div className="wiki-lint">
              {lint.ok ? (
                <span className="wiki-lint-clean">{'No issues found'}</span>
              ) : (
                <>
                  <div className="wiki-lint-summary">
                    {lint.issues.length + ' · ' + issueTypes.map(([type, n]) => type + '×' + n).join(', ')}
                  </div>
                  <ul className="wiki-lint-list">
                    {lint.issues.slice(0, 12).map((i, idx) => (
                      <li key={idx}>
                        <button type="button" className="wiki-lint-link" onClick={() => void openPage(i.slug)}>
                          [{i.type}] {i.slug}
                        </button>
                        <span className="wiki-lint-detail">{i.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {msg && <div className="wiki-msg">{msg}</div>}
        </div>

        <div className="settings-card wiki-browser">
          <div className="wiki-browser-head">
            {hasProject && (
              <div className="wiki-scope-switch" role="tablist">
                <button
                  type="button"
                  className={effectiveScope === 'project' ? 'is-active' : ''}
                  onClick={() => setScope('project')}
                >
                  {projectName || 'Project'}
                </button>
                <button
                  type="button"
                  className={effectiveScope === 'user' ? 'is-active' : ''}
                  onClick={() => setScope('user')}
                >
                  {'Global'}
                </button>
              </div>
            )}
            <div className="wiki-tabs" role="tablist">
              {(['graph', 'pages', 'log'] as Tab[]).map((tb) => (
                <button key={tb} type="button" className={tab === tb ? 'is-active' : ''} onClick={() => setTab(tb)}>
                  {tx('settings.wikiSection.tab' + tb.charAt(0).toUpperCase() + tb.slice(1))}
                </button>
              ))}
            </div>
            <button type="button" className="test-btn" onClick={() => void refresh()} disabled={busy}>
              {'Refresh'}
            </button>
          </div>

          {tab === 'pages' && (
            <>
              <div className="wiki-browser-head wiki-browser-head-sub">
                <Input
                  className="wiki-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label={'Search pages…'}
                  placeholder={'Search pages…'}
                />
                {filter && (
                  <button type="button" className="test-btn" onClick={() => setFilter('')}>
                    ×
                  </button>
                )}
                <button type="button" className="test-btn" onClick={newPage}>
                  {'New page'}
                </button>
              </div>
              {selected && (
                <div className="wiki-editor">
                  <Input
                    className="wiki-input"
                    value={draft.title}
                    aria-label={'Page title'}
                    onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setIsDirty(true) }}
                    placeholder={'Page title'}
                  />
                  <Input
                    className="wiki-input"
                    value={draft.summary}
                    aria-label={'One-line summary (shown in the index)'}
                    onChange={(e) => { setDraft({ ...draft, summary: e.target.value }); setIsDirty(true) }}
                    placeholder={'One-line summary (shown in the index)'}
                  />
                  <Input
                    className="wiki-input"
                    value={draft.tags}
                    aria-label={'tags, comma separated'}
                    onChange={(e) => { setDraft({ ...draft, tags: e.target.value }); setIsDirty(true) }}
                    placeholder={'tags, comma separated'}
                  />
                  <Textarea
                    className="wiki-body"
                    value={draft.body}
                    aria-label={'Page body'}
                    onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setIsDirty(true) }}
                    rows={12}
                  />
                  <div className="wiki-editor-actions">
                    <button type="button" className="test-btn" onClick={() => void savePage()} disabled={busy || !draft.title.trim()}>
                      {'Save'}
                    </button>
                    <button
                      type="button"
                      className="test-btn"
                      onClick={() => {
                        if (isDirty) {
                          setConfirmDiscard(() => closeEditor)
                        } else {
                          closeEditor()
                        }
                      }}
                    >
                      {'Cancel'}
                    </button>
                    {selected.slug && (
                      <>
                        <button type="button" className="test-btn" onClick={() => requestDelete([selected.slug])}>
                          {'Delete'}
                        </button>
                        <span className="wiki-editor-meta">
                          {'Updated'} {fmtDate(selected.updated)}
                          {selected.backlinks > 0 ? ' · ' + 'Backlinks:' + ' ' + selected.backlinks : ''}
                        </span>
                      </>
                    )}
                  </div>
                  {selected.links.length > 0 && (
                    <div className="wiki-page-links">
                      {selected.links.map((slug) => (
                        <button key={slug} type="button" className="wiki-link-chip" onClick={() => void openPage(slug)}>
                          {slug}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {selectedSlugs.size > 0 && (
                <div className="wiki-bulkbar">
                  <span className="wiki-bulkbar-count">{`${selectedSlugs.size} selected`}</span>
                  <button
                    type="button"
                    className="test-btn wiki-bulkbar-delete"
                    onClick={() => requestDelete([...selectedSlugs])}
                    disabled={busy}
                  >
                    {'Delete selected'}
                  </button>
                  <button type="button" className="test-btn" onClick={() => setSelectedSlugs(new Set())}>
                    {'Clear selection'}
                  </button>
                </div>
              )}
              {items.length === 0 ? (
                <div className="settings-empty">{'No pages yet. Ask the agent to remember something, or create a page.'}</div>
              ) : (
                <div className="wiki-table-wrap">
                  <table className="wiki-table">
                    <thead>
                      <tr>
                        <th className="wiki-col-check">
                          <input
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected
                            }}
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            aria-label={'Select all pages'}
                          />
                        </th>
                        <th>
                          <button type="button" className="wiki-sort" onClick={() => setSort('title')}>
                            {'Pages'}
                            {sortKey === 'title' && <span className="wiki-sort-dir">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                          </button>
                        </th>
                        <th className="wiki-col-links">
                          <button type="button" className="wiki-sort" onClick={() => setSort('links')}>
                            {'Links'}
                            {sortKey === 'links' && <span className="wiki-sort-dir">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                          </button>
                        </th>
                        <th className="wiki-col-date">
                          <button type="button" className="wiki-sort" onClick={() => setSort('updated')}>
                            {'Updated'}
                            {sortKey === 'updated' && <span className="wiki-sort-dir">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                          </button>
                        </th>
                        <th className="wiki-col-actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedItems.map((p) => (
                        <tr key={p.slug} className={selectedSlugs.has(p.slug) ? 'is-selected' : ''}>
                          <td className="wiki-col-check">
                            <input
                              type="checkbox"
                              checked={selectedSlugs.has(p.slug)}
                              onChange={() => toggleOne(p.slug)}
                              aria-label={p.title}
                            />
                          </td>
                          <td>
                            <button type="button" className="wiki-row-open" onClick={() => void openPage(p.slug)}>
                              <strong>{p.title}</strong>
                              <span className="wiki-row-summary">{p.summary}</span>
                              {p.tags.length > 0 && <span className="wiki-item-meta">{p.tags.join(', ')}</span>}
                            </button>
                          </td>
                          <td className="wiki-col-links">{p.links.length + p.backlinks}</td>
                          <td className="wiki-col-date">{fmtDate(p.updated)}</td>
                          <td className="wiki-col-actions">
                            <button
                              type="button"
                              className="wiki-item-delete"
                              title={'Delete'}
                              onClick={() => requestDelete([p.slug])}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {items.length > 0 && (
                <div className="wiki-total">{`${total} pages`}</div>
              )}
            </>
          )}

          {tab === 'graph' && (
            <div className="wiki-graph-wrap">
              {graph.nodes.length > 0 && graph.edges.length === 0 && (
                <div className="wiki-graph-hint">
                  <span>{'No [[links]] between pages yet, so the graph has no edges. Run auto-link, or ask the agent to connect related pages.'}</span>
                  <button type="button" className="test-btn" onClick={() => void runAutoLink()} disabled={busy}>
                    {'Auto-link pages'}
                  </button>
                </div>
              )}
              <div className="wiki-graph">
                <WikiGraph graph={graph} selected={selected?.slug || null} onSelect={(slug) => void openPage(slug)} />
              </div>
            </div>
          )}

          {tab === 'log' && (
            <ul className="wiki-list wiki-log">
              {log.length === 0 ? (
                <li className="settings-empty">{'No pages yet. Ask the agent to remember something, or create a page.'}</li>
              ) : (
                log.map((e, i) => (
                  <li key={i} className="wiki-log-entry">
                    <span className="wiki-log-op" data-op={e.op}>
                      {e.op}
                    </span>
                    <span className="wiki-log-title">{e.title}</span>
                    <span className="wiki-log-meta">
                      {e.detail ? e.detail + ' · ' : ''}
                      {fmtDate(e.at)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
