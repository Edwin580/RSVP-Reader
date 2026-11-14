import { useEffect } from 'react'

/**
 * Focus: nothing between you and the book. A web page can't silence other
 * apps' notifications, so this does what it can: the screen stays on, the
 * book fills it (where the browser allows full screen; not on iPhone), and on
 * iPhone and iPad the settings can run Shortcuts that turn Do Not Disturb on
 * and off (focus.ts).
 */

/** Full screen, if the browser allows it here. Needs a tap or key press just before. */
function enterFullscreen(): void {
  const root = document.documentElement
  if (document.fullscreenElement || !root.requestFullscreen) return
  root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
}

function exitFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
}

/**
 * While `on` (a book open with Focus on): keeps the screen awake, asking
 * again whenever the page comes back into view (the system lets go of it
 * when the page is hidden), and leaves full screen when it ends.
 */
export function useFocusMode(on: boolean): void {
  useEffect(() => {
    if (!on) return
    // Opening the book was a tap, so full screen is usually allowed here too.
    enterFullscreen()
    let lock: WakeLockSentinel | null = null
    let live = true
    const keepAwake = () => {
      if (document.visibilityState !== 'visible' || !navigator.wakeLock) return
      navigator.wakeLock.request('screen').then(
        (l) => {
          if (live) lock = l
          else l.release().catch(() => {})
        },
        () => {},
      )
    }
    keepAwake()
    document.addEventListener('visibilitychange', keepAwake)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', keepAwake)
      lock?.release().catch(() => {})
      exitFullscreen()
    }
  }, [on])
}
