import { useLayoutEffect, type RefObject } from 'react'

/**
 * Guide: a line under the whole line in focus, placed on `line` (an element
 * inside `text`, which the words' offsets are measured from). It glides to
 * the next line as the focus moves, except on its first placement (a new
 * page), where it appears in place.
 */
export function useGuideLine(text: RefObject<HTMLElement | null>, line: RefObject<HTMLElement | null>, index: number) {
  useLayoutEffect(() => {
    const t = text.current
    const el = line.current
    if (!t || !el) return
    const current = t.querySelector<HTMLElement>(`[data-i="${index}"]`)
    if (!current) {
      el.style.opacity = '0'
      return
    }
    const top = current.offsetTop
    let left = Infinity
    let right = -Infinity
    let bottom = 0
    for (const s of t.querySelectorAll<HTMLElement>('[data-i]')) {
      if (s.offsetTop !== top) continue
      left = Math.min(left, s.offsetLeft)
      right = Math.max(right, s.offsetLeft + s.offsetWidth)
      bottom = Math.max(bottom, s.offsetTop + s.offsetHeight)
    }
    const placed = el.dataset.placed === '1'
    el.style.transition = placed ? '' : 'none'
    el.style.width = `${right - left}px`
    el.style.transform = `translate(${left}px, ${bottom - 2}px)`
    el.style.opacity = '1'
    el.dataset.placed = '1'
  })
}
