import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { IS_PREVIEW, PREVIEW_PR } from './lib/preview'

if (IS_PREVIEW) document.title = `PR #${PREVIEW_PR} · ${document.title}`

// iOS Safari only shows :active (press) styles when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Cache the app so it opens offline (see service-worker/sw.js). Production
// only: in development it would serve stale files. Pull request previews
// (see lib/preview.ts) skip it too, so they never cache over the real app.
if (import.meta.env.PROD && !IS_PREVIEW && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
