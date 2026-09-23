import { useLayoutEffect, useRef, useState } from 'react'
import { splitAtOrp } from '../lib/rsvp'

interface Props {
  word: string
  /** User multiplier on the device-based size. */
  scale: number
  onClick?: () => void
}

const MIN_SIZE = 28
const MAX_SIZE = 76

/**
 * Shows one word with its Optimal Recognition Point pinned to the centre, so
 * the eye never has to move between words.
 *
 * The size comes from the space this device actually has: roughly a seventh
 * of the available width, capped by screen height for phones in landscape.
 * An unusually long word may slide a little off-centre (at most 15% of the
 * width) and otherwise shrinks, so nothing is ever clipped, long words stay
 * readable on phones, and the eye barely has to move.
 */
export function WordDisplay({ word, scale, onClick }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ width: number; height: number; font: string } | null>(null)

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      setBox({
        width: el.clientWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
        font: `${style.fontWeight} 100px ${style.fontFamily}`,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const [before, pivot, after] = splitAtOrp(word)
  let size = MIN_SIZE
  let shift = 0
  if (box) {
    const base = clamp(Math.min(box.width / 7, box.height * 0.13), MIN_SIZE, MAX_SIZE)
    ;({ size, shift } = layoutWord(before, pivot, after, box.font, box.width, base * scale))
  }

  return (
    <div className="word-frame" ref={frame} onClick={onClick}>
      <div className="reticle" aria-hidden="true" />
      <div className="word" style={{ fontSize: size, transform: shift ? `translateX(${shift}px)` : undefined }}>
        <span className="word-before">{before}</span>
        <span className="word-pivot">{pivot}</span>
        <span className="word-after">{after}</span>
      </div>
      <div className="reticle" aria-hidden="true" />
    </div>
  )
}

let ctx: CanvasRenderingContext2D | null | undefined

/** How far a long word may move off-centre, as a fraction of the width. */
const MAX_SHIFT = 0.15

/**
 * Font size and horizontal offset for a word: as large as `desired` allows
 * while it fits in `width` with the pivot at most MAX_SHIFT off-centre,
 * shifted only as much as needed to keep both ends on screen.
 */
function layoutWord(before: string, pivot: string, after: string, font: string, width: number, desired: number) {
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx || width <= 0) return { size: desired, shift: 0 }
  ctx.font = font
  // Widths at 100px; everything scales linearly with font size.
  const b = ctx.measureText(before).width
  const p = ctx.measureText(pivot).width
  const a = ctx.measureText(after).width
  const usable = width * 0.96
  const half = usable / 2
  const reach = half + width * MAX_SHIFT
  const total = b + p + a
  let size = desired
  if (total > 0) size = Math.min(size, (usable / total) * 100)
  if (a + p / 2 > 0) size = Math.min(size, (reach / (a + p / 2)) * 100)
  if (b + p / 2 > 0) size = Math.min(size, (reach / (b + p / 2)) * 100)
  const k = size / 100
  const left = (b + p / 2) * k
  const right = (a + p / 2) * k
  let shift = 0
  if (right > half) shift = -(right - half)
  else if (left > half) shift = left - half
  return { size, shift }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
