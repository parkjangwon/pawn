import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'

interface Props extends WithTranslation {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  copied: boolean
}

const btnPrimary = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontWeight: 500,
  cursor: 'pointer'
} as const

const btnSecondary = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontWeight: 500,
  cursor: 'pointer'
} as const

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, copied: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
  }

  copyDetails = (): void => {
    const { error } = this.state
    const text = `${error?.message ?? ''}\n\n${error?.stack ?? ''}`
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.setState({ copied: true })
        window.setTimeout(() => this.setState({ copied: false }), 1500)
      })
      .catch(() => {})
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { t } = this.props
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          }}
        >
          <div style={{ maxWidth: 560, padding: 32 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{t('errorBoundary.title')}</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {t('errors.boundaryReassure')}
            </p>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('errors.boundaryStack')}
              </summary>
              <pre
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  overflow: 'auto',
                  fontSize: 12,
                  maxHeight: 320,
                  marginBottom: 20,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => this.setState({ hasError: false, error: null })} style={btnPrimary}>
                {t('errorBoundary.tryAgain')}
              </button>
              <button onClick={() => window.location.reload()} style={btnSecondary}>
                {t('errorBoundary.reload')}
              </button>
              <button onClick={this.copyDetails} style={btnSecondary}>
                {this.state.copied ? t('errors.boundaryCopied') : t('errors.boundaryCopy')}
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default withTranslation()(ErrorBoundary)
