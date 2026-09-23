import { describe, expect, it } from 'vitest'
import { canGrab, DRAG_THRESHOLD, isDrag, TOUCH_GRAB_RADIUS, valueAt } from '../scrub'

describe('scrubber rules', () => {
  it('lets a mouse grab anywhere but a touch only near the handle', () => {
    expect(canGrab('mouse', 10, 300)).toBe(true)
    expect(canGrab('touch', 300 + TOUCH_GRAB_RADIUS, 300)).toBe(true)
    expect(canGrab('touch', 300 + TOUCH_GRAB_RADIUS + 1, 300)).toBe(false)
    expect(canGrab('pen', 10, 300)).toBe(false)
  })

  it('needs a touch to travel before it counts as a drag', () => {
    expect(isDrag('touch', 100, 100 + DRAG_THRESHOLD - 1)).toBe(false)
    expect(isDrag('touch', 100, 100 - DRAG_THRESHOLD)).toBe(true)
    expect(isDrag('mouse', 100, 100)).toBe(true)
  })

  it('maps a position on the bar to a value, clamped to the ends', () => {
    expect(valueAt(50, 0, 200, 1000)).toBe(250)
    expect(valueAt(-20, 0, 200, 1000)).toBe(0)
    expect(valueAt(999, 0, 200, 1000)).toBe(1000)
    expect(valueAt(10, 0, 0, 1000)).toBe(0)
  })
})
