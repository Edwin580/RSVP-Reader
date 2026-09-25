import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Cache the app so it opens offline (see service-worker/sw.js). Production
// only: in development it would serve stale files. Pull request previews
// (built with VITE_PREVIEW) skip it too, so they never cache over the real app.
if (import.meta.env.PROD && !import.meta.env.VITE_PREVIEW && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
