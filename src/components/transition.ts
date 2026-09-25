import { flushSync } from 'react-dom'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Move between screens (library ↔ reader) with a short slide-and-fade, using
 * the browser's View Transitions where available (Safari 18+, Chrome). The
 * direction picks the animation in index.css. Elsewhere, or with reduced
 * motion, the screen just switches.
 */
export function navigate(direction: 'forward' | 'back', update: () => void): void {
  if (!document.startViewTransition || reducedMotion()) {
    update()
    return
  }
  const root = document.documentElement
  root.dataset.nav = direction
  const transition = document.startViewTransition(() => flushSync(update))
  transition.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav
  })
}

export { reducedMotion }
