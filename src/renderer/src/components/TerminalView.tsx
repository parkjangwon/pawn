import { useEffect, useRef } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

interface TerminalViewProps {
  projectPath?: string
}

const TERMINAL_ID = 'main-terminal'

export default function TerminalView({ projectPath }: TerminalViewProps): React.JSX.Element {
  const { t } = useTranslation()
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
        theme: {
          background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4',
          selectionBackground: '#444',
          black: '#1e1e1e', red: '#e34c4c', green: '#4caf50', yellow: '#ffc107',
          blue: '#2196f3', magenta: '#9c27b0', cyan: '#00bcd4', white: '#d4d4d4',
          brightBlack: '#666', brightRed: '#e34c4c', brightGreen: '#4caf50',
          brightYellow: '#ffc107', brightBlue: '#2196f3', brightMagenta: '#9c27b0',
          brightCyan: '#00bcd4', brightWhite: '#fff'
        },
        convertEol: true
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(el)
      termRef.current = term

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
      <div ref={elRef} style={{ position: 'absolute', inset: 0, background: '#1e1e1e' }} />
      <button
        className="terminal-restart-btn"
        onClick={() => setGeneration((g) => g + 1)}
        title={t('rightPanel.terminalRestart')}
        aria-label={t('rightPanel.terminalRestart')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
    </div>
  )
}
