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
  /** A tap that only dismissed selected text. A tap right after it is a double tap. */
  onDismiss?: (target: Element | null) => void
  /**
   * The press has lasted HOLD_MS without moving; `onHoldEnd` follows on
   * release. `target` is what the press started on.
   */
  onHoldStart?: (target: Element | null) => void
  onHoldEnd?: () => void
  onSwipe?: (direction: 'left' | 'right') => void
  /** Called as soon as a press starts, before it's known to be a tap, hold or swipe. */
  onPressStart?: () => void
  /** Called as soon as that press ends (released anywhere, or cancelled), before `onTap`/`onSwipe`. */
  onPressEnd?: () => void
  /** Presses that start on something matching this (a button, say) are left alone. */
  ignore?: (target: Element) => boolean
  /** Where a long press or right-click may open the system menu (selectable text). */
  allowMenu?: (target: Element) => boolean
}

type PointerPoint = { pointerId: number; clientX: number; clientY: number }

/** Whether some text is selected on the page. */
export function hasSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}

/**
 * Guide, with a mouse: a press held this long (ms) without moving selects
 * the word, like a long press on a touch screen. Longer than a glance's
 * hold, since a guide press often rests a moment before it drags.
 */
export const SELECT_HOLD_MS = 550

/** The word on the page at a point on screen (not the old page sliding away), or null. */
export function wordAtPoint(x: number, y: number): number | null {
  const word = document.elementFromPoint(x, y)?.closest<HTMLElement>('.page > .page-text [data-i]')
  return word ? Number(word.dataset.i) : null
}

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
    /** Text was selected when the press began; it's dismissing that. */
    selection: boolean
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
    // The press selected text (a long press or a drag across words): leave it to the system.
    if (hasSelection()) {
      lastGesture.current = 'none'
      return
    }
    const gesture = classifyGesture(e.clientX - p.x, e.clientY - p.y, performance.now() - p.at)
    lastGesture.current = gesture
    // A tap that dismissed a selection does nothing else, but a second tap
    // straight after still makes a double tap.
    if (p.selection) {
      if (gesture === 'tap') {
        lastTap.current = { at: performance.now(), x: p.x, y: p.y }
        latest.current.onDismiss?.(p.target)
      }
      lastGesture.current = 'none'
      return
    }
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
          latest.current.onHoldStart?.(press.current.target)
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
        // A press away from selected text dismisses it (the browser doesn't
        // when the press lands on text that can't be selected).
        const selection = hasSelection()
        if (selection) window.getSelection()?.removeAllRanges()
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at, held: false, timer, release, target, selection }
        // Dismissing a selection isn't the start of anything else.
        if (!selection) latest.current.onPressStart?.()
      },
      onPointerMove: (e: React.PointerEvent) => {
        const p = press.current
        if (!p || p.held || p.id !== e.pointerId) return
        // Moving cancels a pending hold (it's becoming a swipe or a scroll).
        if (Math.abs(e.clientX - p.x) > MOVE_TOLERANCE || Math.abs(e.clientY - p.y) > MOVE_TOLERANCE) {
          window.clearTimeout(p.timer)
        }
      },
      // The browser's own double-click selection would pick whatever word
      // is under the mouse by then; onDoubleTap decides instead.
      onMouseDown: (e: React.MouseEvent) => {
        if (e.detail >= 2) e.preventDefault()
      },
      onPointerUp: (e: React.PointerEvent) => end(e),
      onPointerCancel: (e: React.PointerEvent) => end(e, true),
      // A long press would otherwise open the system menu on touch screens,
      // except on selectable text, where that menu has Look Up and Copy.
      onContextMenu: (e: React.MouseEvent) => {
        if (!(e.target instanceof Element && latest.current.allowMenu?.(e.target))) e.preventDefault()
      },
    },
  }
}
