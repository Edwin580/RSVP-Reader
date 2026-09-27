import { useEffect, useRef } from 'react'
import { classifyGesture, HOLD_MS, MOVE_TOLERANCE, type Gesture } from '../lib/glance'

interface Handlers {
  /** A quick press and release. `target` is what the press started on. */
  onTap?: (target: Element | null) => void
  /**
   * A second tap soon after the first, near it. The first tap still gets
   * `onTap` straight away (so a single tap never waits), and this replaces
   * the second tap's `onTap`.
   */
  onDoubleTap?: (target: Element | null) => void
  /** The press has lasted HOLD_MS without moving; `onHoldEnd` follows on release. */
  onHoldStart?: () => void
  onHoldEnd?: () => void
  onSwipe?: (direction: 'left' | 'right') => void
  /** Called as soon as a press starts, before it's known to be a tap, hold or swipe. */
  onPressStart?: () => void
  /** Called as soon as that press ends (released anywhere, or cancelled), before `onTap`/`onSwipe`. */
  onPressEnd?: () => void
  /** Presses that start on something matching this (a button, say) are left alone. */
  ignore?: (target: Element) => boolean
}

type PointerPoint = { pointerId: number; clientX: number; clientY: number }

/** Two taps this close in time (ms) and distance (px) make a double tap. */
export const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_DISTANCE = 30

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
  const press = useRef<{
    id: number
    x: number
    y: number
    at: number
    held: boolean
    timer: number
    release: () => void
    target: Element | null
  } | null>(null)
  const lastGesture = useRef<Gesture>('none')
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null)

  const end = (e: PointerPoint, cancelled = false) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    window.clearTimeout(p.timer)
    p.release()
    press.current = null
    latest.current.onPressEnd?.()
    if (p.held) {
      lastGesture.current = 'hold'
      latest.current.onHoldEnd?.()
      return
    }
    if (cancelled) return
    const gesture = classifyGesture(e.clientX - p.x, e.clientY - p.y, performance.now() - p.at)
    lastGesture.current = gesture
    if (gesture === 'tap') {
      const now = performance.now()
      const before = lastTap.current
      const double =
        !!before &&
        now - before.at < DOUBLE_TAP_MS &&
        Math.hypot(p.x - before.x, p.y - before.y) < DOUBLE_TAP_DISTANCE &&
        !!latest.current.onDoubleTap
      lastTap.current = double ? null : { at: now, x: p.x, y: p.y }
      if (double) latest.current.onDoubleTap?.(p.target)
      else latest.current.onTap?.(p.target)
    } else if (gesture === 'swipe-left') latest.current.onSwipe?.('left')
    else if (gesture === 'swipe-right') latest.current.onSwipe?.('right')
  }

  return {
    wasSwipe: () => lastGesture.current.startsWith('swipe') || lastGesture.current === 'hold',
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 || press.current) return
        if (e.target instanceof Element && latest.current.ignore?.(e.target)) return
        const at = performance.now()
        // A long press, even one that drifts, stays with this element when
        // what's under the finger is replaced (a page turning), which could
        // otherwise end it. Only after a moment, so a quick tap still reaches
        // the word it landed on.
        const el = e.currentTarget as Element
        const id = e.pointerId
        const capture = window.setTimeout(() => {
          try {
            el.setPointerCapture(id)
          } catch {
            // The pointer is already gone; its release is on the way.
          }
        }, HOLD_MS)
        const timer = window.setTimeout(() => {
          // Without a hold handler a long press is just a slow tap.
          if (!press.current || !latest.current.onHoldStart) return
          press.current.held = true
          latest.current.onHoldStart?.()
        }, HOLD_MS)
        // Also end the press when it's released off the element (a mouse
        // dragged away), so a hold to read never gets stuck playing.
        const up = (u: PointerEvent) => end(u)
        const cancel = (u: PointerEvent) => end(u, true)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', cancel)
        const release = () => {
          window.clearTimeout(capture)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', cancel)
        }
        const target = e.target instanceof Element ? e.target : null
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at, held: false, timer, release, target }
        latest.current.onPressStart?.()
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
