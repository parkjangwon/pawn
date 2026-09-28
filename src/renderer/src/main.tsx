import React from 'react'
import ReactDOM from 'react-dom/client'
import './browser-polyfill'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
// Bundled (not CDN) so the strict CSP `font-src 'self'` still holds.
// Inter stands in for licensed CursorGothic. Pretendard covers Hangul, kana, and Han.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
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
