import { useEffect, useRef } from 'react'
import { useState } from 'react'
import { tx } from '../i18n'
import { RefreshCw } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import type { ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { readPawnTerminalTheme } from './terminalTheme'
import { getHttpLinksForTerminalBufferLine, isHttpTerminalUrl } from './terminalLinks'

interface TerminalViewProps {
  projectPath?: string
}

const TERMINAL_ID = 'main-terminal'

/** Open http(s) URLs via pawn's existing external-browser channel. */
function openTerminalUrl(url: string): void {
  if (!isHttpTerminalUrl(url)) return
  const open = window.api?.browser?.open
  if (open) {
    open(url)?.catch?.(() => {})
  } else {
    window.open(url, '_blank', 'noopener')
  }
}


export default function TerminalView({ projectPath }: TerminalViewProps): React.JSX.Element {
  const elRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [generation, setGeneration] = useState(0)
  const isBrowser = typeof window !== 'undefined' && (window as any).api?.platform === 'browser'

  useEffect(() => {
    const el = elRef.current
    if (!el || termRef.current) return

    let cancelled = false

    const createTerminal = (): void => {
      let eApi: any, eDispose: any
      let ro2: ResizeObserver | null = null
      if (cancelled || termRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: '"JetBrainsMonoNL NF", "JetBrainsMono Nerd Font", "MesloLGS NF", "SF Mono", "Menlo", monospace',
        lineHeight: 1.35,
        theme: readPawnTerminalTheme(),
        convertEol: true,
        linkHandler: {
          allowNonHttpProtocols: false,
          activate: (event, text) => {
            event.preventDefault()
            openTerminalUrl(text)
          }
        }
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(el)
      termRef.current = term

      // xterm theme follows pawn light/dark; plain http(s) URLs open externally.
      const themeObserver = new MutationObserver(() => {
        if (termRef.current) termRef.current.options.theme = readPawnTerminalTheme()
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      const linkProvider = term.registerLinkProvider({
        provideLinks(bufferLineNumber, callback) {
          const links = getHttpLinksForTerminalBufferLine(
            term.buffer.active,
            bufferLineNumber,
            term.cols
          )?.map(
            (link): ILink => ({
              ...link,
              activate: (event, text) => {
                event.preventDefault()
                openTerminalUrl(text)
              }
            })
          )
          callback(links)
        }
      })

      const wsRef: { current: WebSocket | null } = { current: null }

      const doFit = (): void => {
        try { fit.fit() } catch { setTimeout(doFit, 300) }
      }
      setTimeout(doFit, 200)

      const ro = new ResizeObserver((): void => {
        try { fit.fit() } catch { /* not ready */ }
      })
      ro.observe(el)

      if (isBrowser) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(protocol + '//' + window.location.host + '/api/terminal')
        wsRef.current = ws
        ws.onopen = () => {
          const d = fit.proposeDimensions()
          if (d) ws.send(JSON.stringify({ type: 'resize', cols: d.cols, rows: d.rows }))
        }
        ws.onmessage = (e) => {
          try { const m = JSON.parse(e.data); if (m.type === 'data') term.write(m.data) } catch {}
        }
        term.onData((data) => {
          if (wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify({ type: 'input', data }))
        })
      } else {
        eApi = (window as any).api
        const d = fit.proposeDimensions()
        eDispose = eApi.terminal.onData((id: string, data: string) => {
          if (id === TERMINAL_ID && termRef.current) term.write(data)
        })
        term.onData((data) => { eApi.terminal.write(TERMINAL_ID, data) })

        ro.disconnect()
        ro2 = new ResizeObserver((): void => {
          try { fit.fit() } catch {}
          const d2 = fit.proposeDimensions()
          if (d2) eApi.terminal.resize(TERMINAL_ID, d2.cols, d2.rows)
        })
        ro2.observe(el)

        eApi.terminal.create(TERMINAL_ID, d?.cols || 80, d?.rows || 24, projectPath || undefined)
          .then((res: { ok?: boolean; error?: string }) => {
            if (!cancelled && res && res.ok === false) {
              term.write(`\r\n${res.error || 'Failed to start terminal'}\r\n`)
            }
          })
          .catch((err: unknown) => {
            if (!cancelled) term.write(`\r\nFailed to start terminal: ${String(err)}\r\n`)
          })
      }

      cleanupRef.current = () => {
        ro.disconnect()
        ro2?.disconnect()
        themeObserver.disconnect()
        linkProvider.dispose()
        eDispose?.()
        eApi?.terminal.dispose(TERMINAL_ID)
        wsRef.current?.close()
        term.dispose()
        termRef.current = null
        cleanupRef.current = null
      }
    }

    // Wait for the Nerd Font to be available before creating the terminal
    const fontStr = '14px "JetBrainsMonoNL NF"'
    if (document.fonts && document.fonts.load) {
      Promise.race([
        document.fonts.load(fontStr),
        new Promise((r) => setTimeout(r, 1500))
      ]).then(() => { if (!cancelled) createTerminal() })
    } else {
      setTimeout(() => { if (!cancelled) createTerminal() }, 300)
    }

    return () => {
      cancelled = true
      cleanupRef.current?.()
    }
  }, [isBrowser, projectPath, generation])

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, background: 'transparent' }} />
      <button
        className="terminal-restart-btn"
        onClick={() => setGeneration((g) => g + 1)}
        title={'Restart terminal'}
        aria-label={'Restart terminal'}
      >
        <RefreshCw size={14} />
      </button>
    </div>
  )
}
