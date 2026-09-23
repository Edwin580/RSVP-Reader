import { useRef, useState } from 'react'
import { canGrab, isDrag, valueAt } from '../lib/scrub'

interface Props {
  value: number
  max: number
  onSeek: (value: number) => void
  /** Label for a position, shown while dragging (e.g. "34% · Chapter 2"). */
  describe: (value: number) => string
}

interface Gesture {
  id: number
  type: string
  startX: number
  dragging: boolean
}

/**
 * Progress bar for the reading position. A mouse can click anywhere or
 * drag. On touch screens the bar ignores stray touches: only pressing the
 * handle and dragging it moves the position, and only when you let go, so
 * brushing the bar while holding the phone can't lose your place.
 */
export function Scrubber({ value, max, onSeek, describe }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  // While dragging: the position under the finger or cursor, not yet applied.
  const [preview, setPreview] = useState<{ value: number; touch: boolean } | null>(null)

  const shown = preview?.value ?? value
  const percent = max > 0 ? (shown / max) * 100 : 0

  const at = (x: number) => {
    const r = bar.current!.getBoundingClientRect()
    return valueAt(x, r.left, r.width, max)
  }
  const reset = () => {
    gesture.current = null
    setPreview(null)
  }

  return (
    <div
      className={`scrubber${preview !== null ? ' is-dragging' : ''}`}
      ref={bar}
      role="slider"
      aria-label="Position in book"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={describe(value)}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const r = bar.current!.getBoundingClientRect()
        const thumbX = r.left + (max > 0 ? (value / max) * r.width : 0)
        if (!canGrab(e.pointerType, e.clientX, thumbX)) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const dragging = isDrag(e.pointerType, e.clientX, e.clientX)
        gesture.current = { id: e.pointerId, type: e.pointerType, startX: e.clientX, dragging }
        if (dragging) setPreview({ value: at(e.clientX), touch: e.pointerType !== 'mouse' })
      }}
      onPointerMove={(e) => {
        const g = gesture.current
        if (!g || g.id !== e.pointerId) return
        if (!g.dragging) {
          if (!isDrag(g.type, g.startX, e.clientX)) return
          g.dragging = true
        }
        setPreview({ value: at(e.clientX), touch: g.type !== 'mouse' })
      }}
      onPointerUp={(e) => {
        const g = gesture.current
        if (!g || g.id !== e.pointerId) return
        if (g.dragging) onSeek(at(e.clientX))
        reset()
      }}
      onPointerCancel={reset}
    >
      <div className="scrubber-track">
        <div className="scrubber-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="scrubber-thumb" style={{ left: `${percent}%` }} />
      {preview?.touch && (
        <div className="scrubber-bubble" style={{ left: `${percent}%` }}>
          {describe(preview.value)}
        </div>
      )}
    </div>
  )
}
