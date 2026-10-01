import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAppearance, watchThemeColor } from './lib/appearance'
import { IS_PREVIEW, PREVIEW_PR } from './lib/preview'
import { loadSettings } from './lib/storage'

applyAppearance(loadSettings())
watchThemeColor()

if (IS_PREVIEW) document.title = `PR #${PREVIEW_PR} · ${document.title}`

// iOS Safari only shows :active (press) styles when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true })

// No pinch zoom: it only knocks the layout out of shape (Aa changes the text
// size). iOS ignores the viewport's user-scalable=no, but not these.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

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
