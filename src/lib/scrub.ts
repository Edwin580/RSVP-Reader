/**
 * Rules for the progress scrubber. On touch screens only a deliberate drag
 * of the handle may move the reading position: touches elsewhere on the bar
 * are ignored, and a touch on the handle must travel a few pixels before it
 * counts as a drag. A mouse can click anywhere to jump.
 */

/** How close (px) a touch must land to the handle's centre to grab it. */
export const TOUCH_GRAB_RADIUS = 28
/** How far (px) a touch must move before it becomes a drag. */
export const DRAG_THRESHOLD = 8

export function canGrab(pointerType: string, x: number, thumbX: number): boolean {
  return pointerType === 'mouse' || Math.abs(x - thumbX) <= TOUCH_GRAB_RADIUS
}

export function isDrag(pointerType: string, startX: number, x: number): boolean {
  return pointerType === 'mouse' || Math.abs(x - startX) >= DRAG_THRESHOLD
}

/** The value under horizontal position `x` on a bar spanning [left, left + width]. */
export function valueAt(x: number, left: number, width: number, max: number): number {
  if (width <= 0 || max <= 0) return 0
  const t = Math.min(Math.max((x - left) / width, 0), 1)
  return Math.round(t * max)
}
