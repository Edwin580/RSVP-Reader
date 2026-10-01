import { useEffect, useRef } from 'react'

/** Pulled down this far (px), the sheet closes when let go. */
const CLOSE_DISTANCE = 90
/** Or flicked down at least this fast (px per ms). */
const CLOSE_SPEED = 0.5
/** Movement (px) before a press counts as a drag rather than a tap. */
const SLOP = 6

/**
 * Pull a bottom sheet down to put it away, like a native sheet. A drag that
 * starts (or arrives) at the top of the sheet's content moves the whole sheet
 * with the finger instead of bouncing the content; let go far enough down, or
 * flick, and it closes, otherwise it springs back. Only on phones, where the
 * sheet rises from the bottom (see the CSS).
 */
export function useSheetDrag(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const sheet = ref.current
    if (!sheet || !window.matchMedia('(max-width: 640px)').matches) return
    let start: { y: number } | null = null
    let dragging = false
    let offset = 0
    // Recent positions, for the speed of a flick.
    let trail: { y: number; t: number }[] = []

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      start = { y: e.touches[0].clientY }
      dragging = false
      offset = 0
      trail = [{ y: e.touches[0].clientY, t: performance.now() }]
    }
    const move = (e: TouchEvent) => {
      if (!start) return
      const y = e.touches[0].clientY
      const now = performance.now()
      trail = [...trail.filter((p) => now - p.t < 100), { y, t: now }]
      if (!dragging) {
        // Pulling down with the content at its top: the sheet comes with the
        // finger. If the content was scrolled, it scrolls back up first.
        if (sheet.scrollTop > 0) {
          start.y = y
          return
        }
        if (y - start.y < SLOP) {
          if (start.y - y > SLOP) start = null // scrolling up: leave it alone
          return
        }
        dragging = true
        start.y = y
        sheet.style.transition = 'none'
      }
      e.preventDefault()
      offset = Math.max(0, y - start.y)
      sheet.style.transform = `translateY(${offset}px)`
    }
    const up = () => {
      if (!start) return
      start = null
      if (!dragging) return
      dragging = false
      const first = trail[0]
      const last = trail[trail.length - 1]
      const speed = last && first && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0
      if (offset > CLOSE_DISTANCE || speed > CLOSE_SPEED) {
        // Slides on down from where it is (the closing animation has no start point).
        sheet.style.transition = ''
        close.current()
        return
      }
      sheet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)'
      sheet.style.transform = ''
    }

    sheet.addEventListener('touchstart', down, { passive: true })
    // Not passive: a drag has to stop the content bouncing.
    sheet.addEventListener('touchmove', move, { passive: false })
    sheet.addEventListener('touchend', up)
    sheet.addEventListener('touchcancel', up)
    return () => {
      sheet.removeEventListener('touchstart', down)
      sheet.removeEventListener('touchmove', move)
      sheet.removeEventListener('touchend', up)
      sheet.removeEventListener('touchcancel', up)
    }
  }, [ref])
}
