import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModsUiStore } from '../agent/mods/uiStore'
import { getModRuntime } from '../agent/mods/runtime'
import { buildViewDoc, getViewNonce, runBridgeCall, VIEW_TOKENS, type ModView } from '../agent/mods/views'
import { registerModViewFrame } from '../agent/mods/viewFrames'
import { useEffectiveTheme } from '../stores/theme'
import './ModViews.css'

function readTokens(): Record<string, string> {
  const root = document.querySelector('.app') || document.documentElement
  const cs = getComputedStyle(root)
  const out: Record<string, string> = {}
  for (const name of VIEW_TOKENS) {
    const v = cs.getPropertyValue(name).trim()
    if (v) out[name] = v
  }
  return out
}

type Msg = { __pawnView?: number; kind?: string; seq?: number; method?: string; args?: unknown; data?: unknown; height?: number }

/** One sandboxed view. Only messages from this iframe's own window are handled. */
export function ModViewFrame({ view, fill }: { view: ModView; fill?: boolean }): React.JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null)
  const theme = useEffectiveTheme()
  const [nonce, setNonce] = useState<string | null>(null)
  const [height, setHeight] = useState<number>(view.height || 220)

  useEffect(() => {
    let live = true
    void getViewNonce().then((n) => live && setNonce(n))
    return () => {
      live = false
    }
  }, [])

  const doc = useMemo(
    () =>
      nonce === null
        ? ''
        : buildViewDoc({ html: view.html, script: view.script, nonce, tokens: readTokens(), theme: theme === 'dark' ? 'dark' : 'light' }),
    // rev reloads on every open(); theme repaints tokens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nonce, view.rev, theme]
  )

  useEffect(() => {
    const frame = ref.current
    registerModViewFrame(view.plugin, view.id, frame?.contentWindow || null)
    const onMessage = (ev: MessageEvent): void => {
      const win = ref.current?.contentWindow
      if (!win || ev.source !== win) return
      const m = ev.data as Msg
      if (!m || m.__pawnView !== 1) return
      if (m.kind === 'call') {
        const reply = (ok: boolean, value?: unknown, error?: string): void =>
          win.postMessage({ __pawnView: 1, kind: 'reply', seq: m.seq, ok, value, error }, '*')
        const bridge = getModRuntime().viewBridge(view.plugin)
        if (!bridge) return reply(false, undefined, 'mod is not running')
        runBridgeCall(bridge.api, bridge.declaredCalls, String(m.method || ''), m.args).then(
          (value) => reply(true, value),
          (err) => reply(false, undefined, String((err as Error)?.message || err))
        )
      } else if (m.kind === 'send') {
        let data: unknown = null
        try {
          data = m.data === undefined ? null : JSON.parse(JSON.stringify(m.data))
        } catch {
          return
        }
        void getModRuntime()
          .emit('view.message', { plugin: view.plugin, id: view.id, data }, async (e) => e)
          .catch(() => {})
      } else if (m.kind === 'resize' && !fill) {
        const h = Number(m.height)
        if (Number.isFinite(h) && h > 0) setHeight(Math.min(Math.max(Math.round(h), 60), 2000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      registerModViewFrame(view.plugin, view.id, null)
    }
  }, [view.plugin, view.id, fill, doc])

  // Mount a fresh iframe per document: swapping srcdoc on a live sandboxed frame can leave it unpainted.
  if (!doc) return <div className="mod-view-frame mod-view-loading" style={fill ? undefined : { height }} />
  return (
    <iframe
      key={`${view.rev}-${theme}`}
      ref={ref}
      className="mod-view-frame"
      title={`${view.title} (${view.plugin})`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      data-plugin={view.plugin}
      data-view={view.id}
      style={fill ? undefined : { height }}
    />
  )
}

function useViews(placement: ModView['placement']): ModView[] {
  const views = useModsUiStore((s) => s.views)
  return useMemo(() => views.filter((v) => v.placement === placement), [views, placement])
}

function CloseBtn({ view }: { view: ModView }): React.JSX.Element {
  return (
    <button
      type="button"
      className="mod-view-close"
      aria-label={`Close ${view.title}`}
      onClick={() => useModsUiStore.getState().closeView(view.plugin, view.id)}
    >
      {'×'}
    </button>
  )
}

/** Sidebar-docked views (Pawn has no mod tab in the right panel yet). */
export function ModViewPanels(): React.JSX.Element | null {
  const views = useViews('panel')
  if (views.length === 0) return null
  return (
    <div className="mod-view-panels">
      {views.map((v) => (
        <section key={`${v.plugin}/${v.id}`} className="mod-view-panel" data-plugin={v.plugin}>
          <header className="mod-view-head">
            <span className="mod-view-title">{v.title}</span>
            <small className="mod-view-owner">{v.plugin}</small>
            <CloseBtn view={v} />
          </header>
          <ModViewFrame view={v} />
        </section>
      ))}
    </div>
  )
}

/** Tabs above the chat; one view visible at a time. */
export function ModViewTabs(): React.JSX.Element | null {
  const views = useViews('tab')
  const active = useModsUiStore((s) => s.activeViewTab)
  const setActive = useModsUiStore((s) => s.setActiveViewTab)
  if (views.length === 0) return null
  const current = views.find((v) => `${v.plugin}\0${v.id}` === active) || null
  return (
    <div className="mod-view-tabs">
      <div className="mod-view-tablist" role="tablist" aria-label="Mod views">
        {views.map((v) => {
          const key = `${v.plugin}\0${v.id}`
          return (
            <span key={key} className="mod-view-tab-wrap">
              <button
                type="button"
                role="tab"
                aria-selected={current === v}
                className={`mod-view-tab ${current === v ? 'active' : ''}`}
                title={`${v.title} (${v.plugin})`}
                onClick={() => setActive(current === v ? null : key)}
              >
                {v.title}
              </button>
              <CloseBtn view={v} />
            </span>
          )
        })}
      </div>
      {current && (
        <div className="mod-view-tabpanel" role="tabpanel" data-plugin={current.plugin}>
          <ModViewFrame key={`${current.plugin}/${current.id}`} view={current} />
        </div>
      )}
    </div>
  )
}

/** Modal views. Labeled with the owning mod so they can't pass as a Pawn dialog. */
export function ModViewModals(): React.JSX.Element | null {
  const views = useViews('modal')
  const top = views[views.length - 1]
  useEffect(() => {
    if (!top) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useModsUiStore.getState().closeView(top.plugin, top.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [top])
  if (!top) return null
  return createPortal(
    <div className="mod-view-overlay" onMouseDown={(e) => e.target === e.currentTarget && useModsUiStore.getState().closeView(top.plugin, top.id)}>
      <div className="mod-view-modal" role="dialog" aria-modal="true" aria-label={`${top.title} (from mod ${top.plugin})`} data-plugin={top.plugin}>
        <header className="mod-view-head">
          <span className="mod-view-title">{top.title}</span>
          <small className="mod-view-owner">{`mod: ${top.plugin}`}</small>
          <CloseBtn view={top} />
        </header>
        <ModViewFrame view={top} />
      </div>
    </div>,
    document.querySelector('.app') || document.body
  )
}
