import { useEffect, useRef } from 'react'
import { classifyGesture, HOLD_MS, MOVE_TOLERANCE, type Gesture } from '../lib/glance'

interface Handlers {
  onTap?: () => void
  /** The press has lasted HOLD_MS without moving; `onHoldEnd` follows on release. */
  onHoldStart?: () => void
  onHoldEnd?: () => void
  onSwipe?: (direction: 'left' | 'right') => void
}

/**
 * Tap, press-and-hold and horizontal swipe on one element, with mouse, pen or
 * touch. Returns pointer handlers to spread on the element, plus whether the
 * last press was a swipe (so a click it also produces can be ignored).
 */
export function usePressGestures(handlers: Handlers) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const press = useRef<{ id: number; x: number; y: number; at: number; held: boolean; timer: number } | null>(null)
  const lastGesture = useRef<Gesture>('none')

  const end = (e: React.PointerEvent, cancelled = false) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    window.clearTimeout(p.timer)
    press.current = null
    if (p.held) {
      lastGesture.current = 'hold'
      latest.current.onHoldEnd?.()
      return
    }
    if (cancelled) return
    const gesture = classifyGesture(e.clientX - p.x, e.clientY - p.y, performance.now() - p.at)
    lastGesture.current = gesture
    if (gesture === 'tap') latest.current.onTap?.()
    else if (gesture === 'swipe-left') latest.current.onSwipe?.('left')
    else if (gesture === 'swipe-right') latest.current.onSwipe?.('right')
  }

  return {
    wasSwipe: () => lastGesture.current.startsWith('swipe') || lastGesture.current === 'hold',
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 || press.current) return
        const at = performance.now()
        const timer = window.setTimeout(() => {
          // Without a hold handler a long press is just a slow tap.
          if (!press.current || !latest.current.onHoldStart) return
          press.current.held = true
          latest.current.onHoldStart?.()
        }, HOLD_MS)
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at, held: false, timer }
      },
      onPointerMove: (e: React.PointerEvent) => {
        const p = press.current
        if (!p || p.held || p.id !== e.pointerId) return
        // Moving cancels a pending hold (it's becoming a swipe or a scroll).
        if (Math.abs(e.clientX - p.x) > MOVE_TOLERANCE || Math.abs(e.clientY - p.y) > MOVE_TOLERANCE) {
          window.clearTimeout(p.timer)
        }
      },
      onPointerUp: (e: React.PointerEvent) => end(e),
      onPointerCancel: (e: React.PointerEvent) => end(e, true),
      // A long press would otherwise open the system menu on touch screens.
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  }
}
