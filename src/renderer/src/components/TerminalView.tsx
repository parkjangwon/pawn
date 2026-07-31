import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

interface TerminalViewProps {
  projectPath?: string
}

const TERMINAL_ID = 'main-terminal'

export default function TerminalView({ projectPath }: TerminalViewProps): React.JSX.Element {
  const elRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const isBrowser = typeof window !== 'undefined' && (window as any).api?.platform === 'browser'

  useEffect(() => {
    const el = elRef.current
    if (!el || termRef.current) return

    let cancelled = false

    const createTerminal = (): void => {
      let eApi: any, eDispose: any
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
        eDispose = eApi.terminal.onData((_id: string, data: string) => { term.write(data) })
        eApi.terminal.create(TERMINAL_ID, d?.cols || 80, d?.rows || 24, projectPath || undefined)
        term.onData((data) => { eApi.terminal.write(TERMINAL_ID, data) })

        ro.disconnect()
        const ro2 = new ResizeObserver((): void => {
          try { fit.fit() } catch {}
          const d2 = fit.proposeDimensions()
          if (d2) eApi.terminal.resize(TERMINAL_ID, d2.cols, d2.rows)
        })
        ro2.observe(el)
      }

      cleanupRef.current = () => {
        ro.disconnect()
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
  }, [isBrowser, projectPath])

  return <div ref={elRef} style={{ flex: 1, minHeight: 0, background: '#1e1e1e' }} />
}
