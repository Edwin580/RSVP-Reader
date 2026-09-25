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
