import React from 'react'
import ReactDOM from 'react-dom/client'
import './browser-polyfill'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
import './styles/global.css'

window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandled rejection:', e.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
