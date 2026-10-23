// src/main.jsx
import { Component, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { getSiteMode } from './lib/siteMode.js'

const AdminApp = lazy(() => import('./admin/AdminApp.jsx'))
const PublicApp = lazy(() => import('./public/PublicApp.jsx'))

class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error" role="alert">
          <h1>We couldn’t load this page</h1>
          <p>Refresh the page to try again. If the problem continues, check the application setup.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

const SiteApp = getSiteMode() === 'admin' ? AdminApp : PublicApp

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <Suspense
        fallback={
          <main className="app-loading" role="status">
            Loading portfolio…
          </main>
        }
      >
        <SiteApp />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>,
)
